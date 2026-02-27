import type { Logger } from "pino";
import type { IssueStore, IssueSearchResult } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { WikiPageStore } from "./wiki-types.ts";
import { searchWikiPages, type WikiKnowledgeMatch } from "./wiki-retrieval.ts";
import { hybridSearchMerge } from "./hybrid-search.ts";
import { assembleIssueThread, computeBudgetDistribution } from "./thread-assembler.ts";

export type TroubleshootingConfig = {
  enabled: boolean;
  similarityThreshold: number;
  maxResults: number;
  totalBudgetChars: number;
};

export type TroubleshootingMatch = {
  issueNumber: number;
  title: string;
  body: string;
  tailComments: string[];
  semanticComments: string[];
  similarity: number;
  totalChars: number;
};

export type TroubleshootingResult = {
  matches: TroubleshootingMatch[];
  wikiResults: WikiKnowledgeMatch[];
  source: "issues" | "wiki" | "both";
};

/**
 * Extract keywords from issue title and body for wiki fallback queries.
 * Heuristic-based: extracts error messages, component names, and diagnostic terms.
 */
export function extractKeywords(title: string, body: string | null): string {
  const keywords: Set<string> = new Set();

  // Add title words
  for (const word of title.split(/\s+/).filter((w) => w.length > 2)) {
    keywords.add(word);
  }

  if (!body) return Array.from(keywords).join(" ");

  // Extract quoted strings (error messages)
  const quoted = body.match(/"([^"]{5,})"/g) ?? [];
  for (const q of quoted) {
    keywords.add(q.replace(/"/g, ""));
  }

  // Extract single-quoted strings (error messages)
  const singleQuoted = body.match(/'([^']{5,})'/g) ?? [];
  for (const q of singleQuoted) {
    keywords.add(q.replace(/'/g, ""));
  }

  // Extract words after error/exception/crash patterns
  const errorPatterns = body.match(/(?:error|exception|crash|fatal|failed)[:\s]+(\S+(?:\s+\S+){0,3})/gi) ?? [];
  for (const match of errorPatterns) {
    keywords.add(match);
  }

  // Extract capitalized component-like names (PascalCase or ALLCAPS 2+ chars)
  const componentNames = body.match(/\b[A-Z][a-zA-Z]{2,}(?:[A-Z][a-z]+)+\b/g) ?? [];
  for (const name of componentNames) {
    keywords.add(name);
  }

  // Extract ALLCAPS words (acronyms, constants)
  const allCaps = body.match(/\b[A-Z]{2,}\b/g) ?? [];
  for (const cap of allCaps) {
    keywords.add(cap);
  }

  return Array.from(keywords).join(" ");
}

/**
 * Retrieve troubleshooting context from resolved issues and wiki.
 *
 * Pipeline:
 * 1. Hybrid search (vector + BM25) for closed issues
 * 2. Apply similarity floor and PR filter
 * 3. Assemble threads with budget-weighted allocation
 * 4. If no matches, fall back to wiki with dual query
 * 5. If nothing found, return null (silent no-match)
 */
export async function retrieveTroubleshootingContext(params: {
  issueStore: IssueStore;
  wikiPageStore?: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  queryTitle: string;
  queryBody: string | null;
  config: TroubleshootingConfig;
  logger: Logger;
}): Promise<TroubleshootingResult | null> {
  const { issueStore, wikiPageStore, embeddingProvider, repo, queryTitle, queryBody, config, logger } = params;

  // 1. Generate query embedding
  const queryText = queryTitle + "\n\n" + (queryBody ?? "");
  const embedResult = await embeddingProvider.generate(queryText, "query");
  if (!embedResult) {
    logger.debug("Troubleshooting retrieval skipped: embedding generation returned null");
    return null;
  }

  const embedding = embedResult.embedding;

  // 2. Hybrid search with state='closed'
  const fullTextQuery = queryTitle + " " + (queryBody ?? "").slice(0, 200);

  const [vectorSettled, fullTextSettled] = await Promise.allSettled([
    issueStore.searchByEmbedding({
      queryEmbedding: embedding,
      repo,
      topK: 10,
      stateFilter: "closed",
    }),
    issueStore.searchByFullText({
      query: fullTextQuery,
      repo,
      topK: 10,
      stateFilter: "closed",
    }),
  ]);

  const vectorResults = vectorSettled.status === "fulfilled" ? vectorSettled.value : [];
  const fullTextResults = fullTextSettled.status === "fulfilled" ? fullTextSettled.value : [];

  // 3. Merge via RRF
  const merged = hybridSearchMerge<IssueSearchResult>({
    vectorResults,
    bm25Results: fullTextResults,
    getKey: (r) => String(r.record.issueNumber),
  });

  // 4. Apply similarity floor
  const maxDistance = 1 - config.similarityThreshold;

  // Build a lookup of vector distances
  const vectorDistanceMap = new Map<number, number>();
  for (const r of vectorResults) {
    vectorDistanceMap.set(r.record.issueNumber, r.distance);
  }

  const filtered = merged.filter((m) => {
    const vectorDist = vectorDistanceMap.get(m.item.record.issueNumber);
    if (vectorDist !== undefined) {
      // Item appeared in vector results — apply distance threshold
      return vectorDist <= maxDistance;
    }
    // BM25-only match — include (text match on closed issue is relevant)
    return true;
  });

  // 5. Post-filter PRs (exclude all PRs since we can't verify merge status)
  const withoutPRs = filtered.filter((m) => !m.item.record.isPullRequest);

  // 6. Apply maxResults
  const topMatches = withoutPRs.slice(0, config.maxResults);

  // 7. If matches found, assemble threads
  if (topMatches.length > 0) {
    const budgets = computeBudgetDistribution(
      topMatches.map((m) => m.item),
      config.totalBudgetChars,
    );

    const assembledMatches: TroubleshootingMatch[] = [];

    for (let i = 0; i < topMatches.length; i++) {
      const match = topMatches[i]!;
      const budget = budgets[i]!;

      try {
        const thread = await assembleIssueThread({
          issueStore,
          embeddingProvider,
          repo,
          issueNumber: match.item.record.issueNumber,
          queryEmbedding: embedding,
          charBudget: budget,
          logger,
        });

        const vectorDist = vectorDistanceMap.get(match.item.record.issueNumber);
        const similarity = vectorDist !== undefined ? 1 - vectorDist : match.item.distance;

        assembledMatches.push({
          issueNumber: thread.issueNumber,
          title: thread.title,
          body: thread.body,
          tailComments: thread.tailComments,
          semanticComments: thread.semanticComments,
          similarity,
          totalChars: thread.totalChars,
        });
      } catch (err) {
        logger.warn({ issueNumber: match.item.record.issueNumber, err }, "Failed to assemble thread, skipping");
      }
    }

    if (assembledMatches.length > 0) {
      logger.debug({ matchCount: assembledMatches.length }, "Troubleshooting matches found");
      return { matches: assembledMatches, wikiResults: [], source: "issues" };
    }
  }

  // 8. Wiki fallback
  if (!wikiPageStore) {
    logger.debug("No wiki store available for fallback");
    return null;
  }

  const originalQuery = queryTitle + " " + (queryBody ?? "").slice(0, 500);
  const keywordQuery = extractKeywords(queryTitle, queryBody);

  const [wikiOriginal, wikiKeywords] = await Promise.allSettled([
    searchWikiPages({ store: wikiPageStore, embeddingProvider, query: originalQuery, topK: 2, logger }),
    searchWikiPages({ store: wikiPageStore, embeddingProvider, query: keywordQuery, topK: 2, logger }),
  ]);

  const wikiResults1 = wikiOriginal.status === "fulfilled" ? wikiOriginal.value : [];
  const wikiResults2 = wikiKeywords.status === "fulfilled" ? wikiKeywords.value : [];

  // Deduplicate by pageId, keep best distance
  const seenPages = new Map<number, WikiKnowledgeMatch>();
  for (const result of [...wikiResults1, ...wikiResults2]) {
    const existing = seenPages.get(result.pageId);
    if (!existing || result.distance < existing.distance) {
      seenPages.set(result.pageId, result);
    }
  }

  const deduped = Array.from(seenPages.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 2);

  if (deduped.length === 0) {
    logger.debug("No troubleshooting matches found (issues or wiki)");
    return null;
  }

  logger.debug({ wikiCount: deduped.length }, "Wiki fallback results found");
  return { matches: [], wikiResults: deduped, source: "wiki" };
}
