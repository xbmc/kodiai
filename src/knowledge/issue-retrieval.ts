import type { Logger } from "pino";
import type { EmbeddingProvider } from "./types.ts";
import type { IssueStore, IssueSearchResult } from "./issue-types.ts";

/**
 * An issue knowledge match with source attribution metadata.
 * Returned by searchIssues() for use in the retrieval pipeline.
 */
export type IssueKnowledgeMatch = {
  chunkText: string;
  distance: number;
  repo: string;
  issueNumber: number;
  title: string;
  state: string;
  authorLogin: string;
  githubCreatedAt: string;
  source: "issue";
};

/** Default cosine distance threshold for issue search. */
const DEFAULT_DISTANCE_THRESHOLD = 0.7;

/**
 * Search the issue vector store for content relevant to a query.
 *
 * Fail-open: returns empty array on embedding failure or store errors.
 * Results are filtered by distance threshold and sorted by distance (best first).
 */
export async function searchIssues(opts: {
  store: IssueStore;
  embeddingProvider: EmbeddingProvider;
  query: string;
  repo: string;
  topK: number;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<IssueKnowledgeMatch[]> {
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
    logger.debug("Issue search skipped: embedding generation returned null");
    return [];
  }

  const searchResults: IssueSearchResult[] = await store.searchByEmbedding({
    queryEmbedding: embedResult.embedding,
    repo,
    topK,
  });

  // Filter by distance threshold and map to IssueKnowledgeMatch
  return searchResults
    .filter((r) => r.distance <= distanceThreshold)
    .map((r) => ({
      chunkText: `#${r.record.issueNumber} ${r.record.title}\n\n${(r.record.body ?? "").slice(0, 2000)}`,
      distance: r.distance,
      repo: r.record.repo,
      issueNumber: r.record.issueNumber,
      title: r.record.title,
      state: r.record.state,
      authorLogin: r.record.authorLogin,
      githubCreatedAt: r.record.githubCreatedAt,
      source: "issue" as const,
    }));
}
