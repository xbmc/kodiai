/**
 * PR-to-issue linking orchestrator.
 *
 * Resolves explicit issue references (from PR body and commit messages) against
 * the issue corpus, with semantic search fallback when no explicit references exist.
 *
 * Follows fail-open philosophy: embedding or search failures are logged but never
 * block the review pipeline.
 *
 * @module issue-linker
 * @phase 108 (PRLINK-01, PRLINK-02)
 */

import type { Logger } from "pino";
import type { IssueStore } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import { parseIssueReferences } from "../lib/issue-reference-parser.ts";

export type LinkedIssue = {
  issueNumber: number;
  repo: string;
  title: string;
  state: string;
  descriptionSummary: string;
  linkType: "referenced" | "semantic";
  /** Only present for referenced issues */
  keyword?: string;
  /** Only present for semantic matches (0-1 scale, 1 = identical) */
  similarity?: number;
};

export type LinkResult = {
  referencedIssues: LinkedIssue[];
  semanticMatches: LinkedIssue[];
};

const EMPTY_RESULT: LinkResult = { referencedIssues: [], semanticMatches: [] };

/** Default similarity threshold (80% = 0.20 max cosine distance). */
const DEFAULT_SEMANTIC_THRESHOLD = 0.80;

/** Default maximum semantic search results. */
const DEFAULT_MAX_SEMANTIC_RESULTS = 3;

/** Maximum characters for description summary. */
const MAX_DESCRIPTION_CHARS = 500;

/**
 * Truncate and clean an issue body for use as a compact description summary.
 * Strips simple markdown formatting for brevity.
 */
function truncateDescription(body: string | null, maxChars: number = MAX_DESCRIPTION_CHARS): string {
  if (!body) return "";

  let text = body
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    // Convert markdown links to just text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Normalize line endings
    .replace(/\r\n/g, "\n")
    // Collapse multiple newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > maxChars) {
    text = text.slice(0, maxChars).trimEnd() + "...";
  }

  return text;
}

/**
 * Link a PR to related issues via explicit references and semantic search.
 *
 * Flow:
 * 1. Parse references from PR body + commit messages
 * 2. Fetch referenced issues from the corpus
 * 3. If no explicit refs found, fall back to semantic search
 *
 * Semantic search is skipped entirely when explicit references exist
 * (per CONTEXT.md: "trust the author's references").
 */
export async function linkPRToIssues(params: {
  prBody: string;
  prTitle: string;
  commitMessages: string[];
  diffSummary: string;
  /** "owner/repo" format */
  repo: string;
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
  /** Minimum similarity for semantic matches (0-1 scale). Default: 0.80 */
  semanticThreshold?: number;
  /** Maximum semantic search results. Default: 3 */
  maxSemanticResults?: number;
}): Promise<LinkResult> {
  const {
    prBody,
    prTitle,
    commitMessages,
    diffSummary,
    repo,
    issueStore,
    embeddingProvider,
    logger,
    semanticThreshold = DEFAULT_SEMANTIC_THRESHOLD,
    maxSemanticResults = DEFAULT_MAX_SEMANTIC_RESULTS,
  } = params;

  try {
    // Step 1: Parse explicit references
    const parsedRefs = parseIssueReferences({ prBody, commitMessages });

    // Step 2: Fetch referenced issues from corpus
    const referencedIssues: LinkedIssue[] = [];

    for (const ref of parsedRefs) {
      if (ref.crossRepo !== null) {
        logger.debug(
          { crossRepo: ref.crossRepo, issueNumber: ref.issueNumber },
          "Cross-repo reference not in local corpus, skipping",
        );
        continue;
      }

      try {
        const record = await issueStore.getByNumber(repo, ref.issueNumber);
        if (!record) {
          logger.warn(
            { repo, issueNumber: ref.issueNumber },
            "Referenced issue not found in corpus",
          );
          continue;
        }

        referencedIssues.push({
          issueNumber: record.issueNumber,
          repo,
          title: record.title,
          state: record.state,
          descriptionSummary: truncateDescription(record.body),
          linkType: "referenced",
          keyword: ref.keyword,
        });
      } catch (err) {
        logger.warn(
          { repo, issueNumber: ref.issueNumber, err },
          "Failed to fetch referenced issue (fail-open)",
        );
      }
    }

    // Step 3: If explicit refs found, skip semantic search
    if (referencedIssues.length > 0) {
      return { referencedIssues, semanticMatches: [] };
    }

    // Step 4: Semantic search fallback (only when no explicit refs)
    const semanticMatches = await findSemanticMatches({
      prTitle,
      prBody,
      diffSummary,
      repo,
      issueStore,
      embeddingProvider,
      logger,
      threshold: semanticThreshold,
      maxResults: maxSemanticResults,
    });

    return { referencedIssues: [], semanticMatches };
  } catch (err) {
    logger.error({ repo, err }, "PR-issue linking failed (fail-open)");
    return EMPTY_RESULT;
  }
}

/**
 * Find semantically related issues using embedding similarity search.
 */
async function findSemanticMatches(params: {
  prTitle: string;
  prBody: string;
  diffSummary: string;
  repo: string;
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
  threshold: number;
  maxResults: number;
}): Promise<LinkedIssue[]> {
  const {
    prTitle, prBody, diffSummary, repo,
    issueStore, embeddingProvider, logger,
    threshold, maxResults,
  } = params;

  // Build search query from PR title + truncated body + diff summary
  const queryParts = [prTitle];
  if (prBody) queryParts.push(prBody.slice(0, 500));
  if (diffSummary) queryParts.push(diffSummary);
  const query = queryParts.join("\n").trim();

  if (!query) {
    return [];
  }

  try {
    // Generate embedding for the query
    const embedResult = await embeddingProvider.generate(query, "query");
    if (!embedResult?.embedding) {
      logger.warn("Embedding generation returned null for PR-issue semantic search (fail-open)");
      return [];
    }

    // Search issue corpus
    const results = await issueStore.searchByEmbedding({
      queryEmbedding: embedResult.embedding,
      repo,
      topK: maxResults * 2, // Fetch extra to allow threshold filtering
    });

    // Filter by similarity threshold (distance = 1 - similarity)
    const maxDistance = 1 - threshold;
    const filtered = results
      .filter(r => r.distance <= maxDistance)
      .slice(0, maxResults);

    return filtered.map(r => ({
      issueNumber: r.record.issueNumber,
      repo,
      title: r.record.title,
      state: r.record.state,
      descriptionSummary: truncateDescription(r.record.body),
      linkType: "semantic" as const,
      similarity: 1 - r.distance,
    }));
  } catch (err) {
    logger.warn({ repo, err }, "Semantic issue search failed (fail-open)");
    return [];
  }
}
