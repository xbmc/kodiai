import type { Logger } from "pino";
import type { EmbeddingProvider } from "./types.ts";
import type { WikiPageStore, WikiPageSearchResult } from "./wiki-types.ts";

/**
 * A wiki knowledge match with source attribution metadata.
 * Returned by searchWikiPages() for use in the retrieval pipeline.
 */
export type WikiKnowledgeMatch = {
  chunkText: string;
  rawText: string;
  distance: number;
  pageId: number;
  pageTitle: string;
  namespace: string;
  pageUrl: string;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  lastModified: string | null;
  source: "wiki";
};

/** Default cosine distance threshold for wiki page search. */
const DEFAULT_DISTANCE_THRESHOLD = 0.7;

/**
 * Search the wiki page vector store for content relevant to a query.
 *
 * Fail-open: returns empty array on embedding failure or store errors.
 * Results are filtered by distance threshold and sorted by distance (best first).
 */
export async function searchWikiPages(opts: {
  store: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  query: string;
  topK: number;
  namespace?: string;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<WikiKnowledgeMatch[]> {
  const {
    store,
    embeddingProvider,
    query,
    topK,
    namespace,
    distanceThreshold = DEFAULT_DISTANCE_THRESHOLD,
    logger,
  } = opts;

  // Generate embedding for query (fail-open: null means skip)
  const embedResult = await embeddingProvider.generate(query, "query");
  if (!embedResult) {
    logger.debug("Wiki page search skipped: embedding generation returned null");
    return [];
  }

  const searchResults: WikiPageSearchResult[] = await store.searchByEmbedding({
    queryEmbedding: embedResult.embedding,
    topK,
    namespace,
  });

  // Filter by distance threshold and map to WikiKnowledgeMatch
  return searchResults
    .filter((r) => r.distance <= distanceThreshold)
    .map((r) => {
      // Build full URL with section anchor for deep linking
      const fullUrl = r.record.sectionAnchor
        ? `${r.record.pageUrl}#${r.record.sectionAnchor}`
        : r.record.pageUrl;

      return {
        chunkText: r.record.chunkText,
        rawText: r.record.rawText,
        distance: r.distance,
        pageId: r.record.pageId,
        pageTitle: r.record.pageTitle,
        namespace: r.record.namespace,
        pageUrl: fullUrl,
        sectionHeading: r.record.sectionHeading,
        sectionAnchor: r.record.sectionAnchor,
        lastModified: r.record.lastModified,
        source: "wiki" as const,
      };
    });
}
