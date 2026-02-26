/**
 * Cluster pattern matcher: matches PR diffs against active review clusters
 * using dual signals (embedding cosine similarity + file path overlap).
 *
 * Returns top 3 matching patterns with combined scores above threshold.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { ClusterStore, ClusterPatternMatch } from "./cluster-types.ts";
import { cosineSimilarity } from "./cluster-pipeline.ts";

// ── Constants ────────────────────────────────────────────────────────

const MAX_PATTERN_MATCHES = 3;
const MIN_COMBINED_SCORE = 0.3;
const EMBEDDING_WEIGHT = 0.6;
const FILE_PATH_WEIGHT = 0.4;
const RECENCY_WINDOW_DAYS = 60;

// ── Helpers ──────────────────────────────────────────────────────────

/** Jaccard similarity between two sets of file paths. */
function filePathOverlap(prPaths: string[], clusterPaths: string[]): number {
  if (prPaths.length === 0 && clusterPaths.length === 0) return 0;
  const prSet = new Set(prPaths);
  const clusterSet = new Set(clusterPaths);
  const intersection = [...prSet].filter((p) => clusterSet.has(p)).length;
  const union = new Set([...prSet, ...clusterSet]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Matcher ──────────────────────────────────────────────────────────

export type MatchPatternsInput = {
  /** Embedding of the PR diff (1024-dim voyage-code-3). Null = fail-open, returns []. */
  prEmbedding: Float32Array | null;
  /** File paths changed in the PR. */
  prFilePaths: string[];
  /** Repository identifier. */
  repo: string;
};

/**
 * Match PR diff against active clusters using dual signals:
 * 1. Cosine similarity between PR embedding and cluster centroid (60% weight)
 * 2. Jaccard overlap between PR file paths and cluster file paths (40% weight)
 * 3. Recency weighting: clusters with more recent comments score higher
 *
 * Filters: combined score >= 0.3, 3+ members in 60-day window, not retired.
 * Returns: Top 3 matches sorted by combined score DESC.
 */
export async function matchClusterPatterns(
  input: MatchPatternsInput,
  store: ClusterStore,
  sql: Sql,
  logger: Logger,
): Promise<ClusterPatternMatch[]> {
  // Fail-open: no embedding -> no patterns
  if (!input.prEmbedding) {
    return [];
  }

  try {
    // Fetch active (non-retired) clusters for this repo
    const clusters = await store.getActiveClusters(input.repo);
    if (clusters.length === 0) return [];

    const candidates: Array<ClusterPatternMatch & { _recencyWeight: number }> = [];

    for (const cluster of clusters) {
      if (cluster.centroid.length === 0) continue;

      // Signal 1: Embedding cosine similarity
      const similarity = cosineSimilarity(input.prEmbedding, cluster.centroid);

      // Signal 2: File path overlap (Jaccard)
      const pathOverlap = filePathOverlap(input.prFilePaths, cluster.filePaths);

      // Signal 3: Recency — count recent members and compute recency weight
      const recentRows = await sql`
        SELECT
          COUNT(*)::int AS cnt,
          AVG(EXTRACT(EPOCH FROM (NOW() - rc.github_created_at)) / 86400)::real AS avg_age_days
        FROM review_cluster_assignments rca
        JOIN review_comments rc ON rca.review_comment_id = rc.id
        WHERE rca.cluster_id = ${cluster.id}
          AND rc.github_created_at >= NOW() - INTERVAL '60 days'
          AND rc.deleted = false
      `;

      const recentCount = (recentRows[0]?.cnt as number) ?? 0;
      const avgAgeDays = (recentRows[0]?.avg_age_days as number) ?? RECENCY_WINDOW_DAYS;

      // Filter: must have 3+ members in 60-day window
      if (recentCount < 3) continue;

      // Recency weight: 0.5 (old) to 1.0 (very recent)
      const recencyWeight = Math.max(0.5, 1 - avgAgeDays / RECENCY_WINDOW_DAYS);

      // Combined score
      const rawScore = EMBEDDING_WEIGHT * similarity + FILE_PATH_WEIGHT * pathOverlap;
      const combinedScore = rawScore * recencyWeight;

      // Filter: minimum threshold
      if (combinedScore < MIN_COMBINED_SCORE) continue;

      // Fetch representative sample
      const assignments = await store.getAssignmentsByCluster(cluster.id);
      let representativeSample = "";
      if (assignments.length > 0) {
        const topAssignment = assignments[0]!;
        const sampleRows = await sql`
          SELECT chunk_text FROM review_comments
          WHERE id = ${topAssignment.reviewCommentId}
          LIMIT 1
        `;
        representativeSample = (sampleRows[0]?.chunk_text as string) ?? "";
      }

      candidates.push({
        clusterId: cluster.id,
        slug: cluster.slug,
        label: cluster.label,
        memberCount: recentCount,
        similarityScore: similarity,
        filePathOverlap: pathOverlap,
        combinedScore,
        representativeSample,
        _recencyWeight: recencyWeight,
      });
    }

    // Sort by combined score descending, take top 3
    candidates.sort((a, b) => b.combinedScore - a.combinedScore);
    const topMatches = candidates.slice(0, MAX_PATTERN_MATCHES);

    // Strip internal field
    return topMatches.map(({ _recencyWeight, ...match }) => match);
  } catch (err) {
    // Fail-open: log and return empty
    logger.warn({ err, repo: input.repo }, "Cluster pattern matching failed (fail-open)");
    return [];
  }
}
