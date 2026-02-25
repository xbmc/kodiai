import type { Logger } from "pino";
import type { EmbeddingProvider } from "./types.ts";
import type { ReviewCommentStore, ReviewCommentSearchResult } from "./review-comment-types.ts";

/**
 * A review comment match with source attribution metadata.
 * Returned by searchReviewComments() for use in the retrieval pipeline.
 */
export type ReviewCommentMatch = {
  chunkText: string;
  distance: number;
  repo: string;
  prNumber: number;
  prTitle: string | null;
  filePath: string | null;
  authorLogin: string;
  authorAssociation: string | null;
  githubCreatedAt: string;
  startLine: number | null;
  endLine: number | null;
  source: "review_comment";
};

/** Default cosine distance threshold for review comment search. */
const DEFAULT_DISTANCE_THRESHOLD = 0.7;

/**
 * Search the review comment vector store for comments relevant to a query.
 *
 * Fail-open: returns empty array on embedding failure or store errors.
 * Results are filtered by distance threshold and sorted by distance (best first).
 */
export async function searchReviewComments(opts: {
  store: ReviewCommentStore;
  embeddingProvider: EmbeddingProvider;
  query: string;
  repo: string;
  topK: number;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<ReviewCommentMatch[]> {
  const {
    store,
    embeddingProvider,
    query,
    repo,
    topK,
    distanceThreshold = DEFAULT_DISTANCE_THRESHOLD,
    logger,
  } = opts;

  // Generate embedding for query (fail-open: null means skip)
  const embedResult = await embeddingProvider.generate(query, "query");
  if (!embedResult) {
    logger.debug("Review comment search skipped: embedding generation returned null");
    return [];
  }

  const searchResults: ReviewCommentSearchResult[] = await store.searchByEmbedding({
    queryEmbedding: embedResult.embedding,
    repo,
    topK,
  });

  // Filter by distance threshold and map to ReviewCommentMatch
  return searchResults
    .filter((r) => r.distance <= distanceThreshold)
    .map((r) => ({
      chunkText: r.record.chunkText,
      distance: r.distance,
      repo: r.record.repo,
      prNumber: r.record.prNumber,
      prTitle: r.record.prTitle,
      filePath: r.record.filePath,
      authorLogin: r.record.authorLogin,
      authorAssociation: r.record.authorAssociation,
      githubCreatedAt: r.record.githubCreatedAt,
      startLine: r.record.startLine,
      endLine: r.record.endLine,
      source: "review_comment" as const,
    }));
}
