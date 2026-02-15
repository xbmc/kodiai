import type { Logger } from "pino";
import type {
  LearningMemoryStore,
  RetrievalResult,
  RetrievalWithProvenance,
} from "./types.ts";

export type IsolationLayer = {
  retrieveWithIsolation(params: {
    queryEmbedding: Float32Array;
    repo: string;
    owner: string;
    sharingEnabled: boolean;
    topK: number;
    distanceThreshold: number;
    logger: Logger;
  }): RetrievalWithProvenance;
};

/**
 * Create an isolation layer that enforces repo-scoped retrieval
 * with optional owner-level shared pool and full provenance logging.
 */
export function createIsolationLayer(opts: {
  memoryStore: LearningMemoryStore;
  logger: Logger;
}): IsolationLayer {
  const { memoryStore, logger: baseLogger } = opts;

  return {
    retrieveWithIsolation(params): RetrievalWithProvenance {
      const {
        queryEmbedding,
        repo,
        owner,
        sharingEnabled,
        topK,
        distanceThreshold,
        logger: reqLogger,
      } = params;

      const log = reqLogger || baseLogger;

      // Step 1: Always query repo-scoped memories first
      const repoResults = memoryStore.retrieveMemories({
        queryEmbedding,
        repo,
        topK,
      });

      // Step 2: Filter by distance threshold (lower distance = more similar)
      const filteredRepo = repoResults.filter((r) => r.distance <= distanceThreshold);

      let sharedResults: { memoryId: number; distance: number }[] = [];

      // Step 3: If sharing enabled, query owner's other repos
      if (sharingEnabled) {
        const rawShared = memoryStore.retrieveMemoriesForOwner({
          queryEmbedding,
          owner,
          excludeRepo: repo,
          topK,
        });

        sharedResults = rawShared.filter((r) => r.distance <= distanceThreshold);
      }

      // Step 4: Merge, dedupe by memory_id, sort by distance, take topK
      const allCandidates = [...filteredRepo, ...sharedResults];
      const seen = new Set<number>();
      const deduped = allCandidates.filter((r) => {
        if (seen.has(r.memoryId)) return false;
        seen.add(r.memoryId);
        return true;
      });

      deduped.sort((a, b) => a.distance - b.distance);
      const topCandidates = deduped.slice(0, topK);

      // Step 5: Resolve full records and build provenance
      const results: RetrievalResult[] = [];
      const repoSources = new Set<string>();

      for (const candidate of topCandidates) {
        const record = memoryStore.getMemoryRecord(candidate.memoryId);
        if (!record) continue;

        results.push({
          memoryId: candidate.memoryId,
          distance: candidate.distance,
          record,
          sourceRepo: record.sourceRepo,
        });

        repoSources.add(record.sourceRepo);
      }

      const provenance = {
        repoSources: Array.from(repoSources),
        sharedPoolUsed: sharingEnabled && sharedResults.length > 0,
        totalCandidates: allCandidates.length,
        query: {
          repo,
          topK,
          threshold: distanceThreshold,
        },
      };

      // Step 6: Log provenance at debug level
      log.debug(
        {
          repo,
          owner,
          sharingEnabled,
          repoResultCount: filteredRepo.length,
          sharedResultCount: sharedResults.length,
          totalResults: results.length,
          repoSources: provenance.repoSources,
          sharedPoolUsed: provenance.sharedPoolUsed,
        },
        "Learning memory retrieval completed with provenance",
      );

      return { results, provenance };
    },
  };
}
