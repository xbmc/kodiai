import type { Logger } from "pino";
import type { CanonicalCodeStore, CanonicalChunkSearchResult } from "./canonical-code-types.ts";
import type { EmbeddingProvider } from "./types.ts";

export type CanonicalCodeMatch = {
  id: bigint;
  chunkText: string;
  distance: number;
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  chunkType: string;
  symbolName: string | null;
  contentHash: string;
  embeddingModel: string | null;
  source: "canonical_code";
};

const DEFAULT_DISTANCE_THRESHOLD = 0.7;

export async function searchCanonicalCode(opts: {
  store: Pick<CanonicalCodeStore, "searchByEmbedding">;
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  query: string;
  repo: string;
  canonicalRef: string;
  topK: number;
  language?: string;
  distanceThreshold?: number;
  logger: Logger;
}): Promise<CanonicalCodeMatch[]> {
  const {
    store,
    embeddingProvider,
    query,
    repo,
    canonicalRef,
    topK,
    language,
    distanceThreshold = DEFAULT_DISTANCE_THRESHOLD,
    logger,
  } = opts;

  try {
    const embedResult = await embeddingProvider.generate(query, "query");
    if (!embedResult) {
      logger.debug("Canonical code search skipped: embedding generation returned null");
      return [];
    }

    const searchResults: CanonicalChunkSearchResult[] = await store.searchByEmbedding({
      queryEmbedding: embedResult.embedding,
      repo,
      canonicalRef,
      topK,
      language,
      distanceThreshold,
    });

    return searchResults.map((result) => ({
      id: result.id,
      chunkText: result.chunkText,
      distance: result.distance,
      repo: result.repo,
      owner: result.owner,
      canonicalRef: result.canonicalRef,
      commitSha: result.commitSha,
      filePath: result.filePath,
      language: result.language,
      startLine: result.startLine,
      endLine: result.endLine,
      chunkType: result.chunkType,
      symbolName: result.symbolName,
      contentHash: result.contentHash,
      embeddingModel: result.embeddingModel,
      source: "canonical_code" as const,
    }));
  } catch (err: unknown) {
    logger.warn({ err }, "Canonical code search failed (fail-open)");
    return [];
  }
}
