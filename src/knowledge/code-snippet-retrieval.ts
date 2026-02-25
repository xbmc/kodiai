/**
 * Code snippet vector search with fail-open semantics.
 *
 * Searches the code_snippets table for hunk embeddings relevant to a query.
 * Returns empty array on any failure (embedding unavailable, store error).
 */

import type { Logger } from "pino";
import type { EmbeddingProvider } from "./types.ts";
import type { CodeSnippetStore, CodeSnippetSearchResult } from "./code-snippet-types.ts";

/**
 * A code snippet match with source attribution metadata.
 * Returned by searchCodeSnippets() for use in the retrieval pipeline.
 */
export type CodeSnippetMatch = {
  embeddedText: string;
  distance: number;
  contentHash: string;
  repo: string;
  prNumber: number;
  prTitle: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  createdAt: string;
  source: "snippet";
};

/** Default cosine distance threshold for code snippet search. */
const DEFAULT_DISTANCE_THRESHOLD = 0.7;

/**
 * Search the code snippet vector store for hunks relevant to a query.
 *
 * Fail-open: returns empty array on embedding failure or store errors.
 * Results are filtered by distance threshold and sorted by distance (best first).
 */
export async function searchCodeSnippets(opts: {
  store: CodeSnippetStore;
  embeddingProvider: EmbeddingProvider;
  query: string;
  repo: string;
  topK: number;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<CodeSnippetMatch[]> {
  const {
    store,
    embeddingProvider,
    query,
    repo,
    topK,
    distanceThreshold = DEFAULT_DISTANCE_THRESHOLD,
    logger,
  } = opts;

  try {
    // Generate embedding for query (fail-open: null means skip)
    const embedResult = await embeddingProvider.generate(query, "query");
    if (!embedResult) {
      logger.debug("Code snippet search skipped: embedding generation returned null");
      return [];
    }

    const searchResults: CodeSnippetSearchResult[] = await store.searchByEmbedding({
      queryEmbedding: embedResult.embedding,
      repo,
      topK,
      distanceThreshold,
    });

    return searchResults.map((r) => ({
      embeddedText: r.embeddedText,
      distance: r.distance,
      contentHash: r.contentHash,
      repo: r.repo,
      prNumber: r.prNumber,
      prTitle: r.prTitle,
      filePath: r.filePath,
      startLine: r.startLine,
      endLine: r.endLine,
      language: r.language,
      createdAt: r.createdAt,
      source: "snippet" as const,
    }));
  } catch (err: unknown) {
    logger.warn({ err }, "Code snippet search failed (fail-open)");
    return [];
  }
}
