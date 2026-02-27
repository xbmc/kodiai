import type { Logger } from "pino";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import { buildIssueEmbeddingText } from "../knowledge/issue-comment-chunker.ts";

export type DuplicateCandidate = {
  issueNumber: number;
  title: string;
  state: string;
  similarityPct: number;
};

/**
 * Search the issue corpus for vector-similar candidates to a new issue.
 *
 * Fail-open: returns empty array on any embedding or search failure (DUPL-04).
 * Never closes issues or calls any GitHub API (DUPL-03).
 */
export async function findDuplicateCandidates(params: {
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  title: string;
  body: string | null;
  repo: string;
  excludeIssueNumber: number;
  threshold: number;
  maxCandidates: number;
  logger: Logger;
}): Promise<DuplicateCandidate[]> {
  const {
    issueStore,
    embeddingProvider,
    title,
    body,
    repo,
    excludeIssueNumber,
    threshold,
    maxCandidates,
    logger,
  } = params;

  try {
    const text = buildIssueEmbeddingText(title, body);
    const embedResult = await embeddingProvider.generate(text, "query");

    if (!embedResult) {
      logger.warn("Embedding generation returned null for duplicate detection (fail-open)");
      return [];
    }

    const results = await issueStore.searchByEmbedding({
      queryEmbedding: embedResult.embedding,
      repo,
      topK: maxCandidates * 2,
    });

    return results
      .filter((r) => r.record.issueNumber !== excludeIssueNumber)
      .map((r) => ({
        issueNumber: r.record.issueNumber,
        title: r.record.title,
        state: r.record.state,
        similarityPct: Math.round((1 - r.distance) * 100),
      }))
      .filter((c) => c.similarityPct >= threshold)
      .slice(0, maxCandidates);
  } catch (err) {
    logger.warn({ err }, "Duplicate detection failed (fail-open)");
    return [];
  }
}
