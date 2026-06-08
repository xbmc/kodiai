/**
 * Cluster builder for per-repo positive/negative suggestion models.
 *
 * Reads learning memories (with embeddings) for a repo, splits by outcome
 * class (positive = accepted/thumbs_up, negative = suppressed/thumbs_down),
 * runs HDBSCAN on each class independently, computes centroids per cluster,
 * and persists a SuggestionClusterModel via the SuggestionClusterStore.
 *
 * The builder is decoupled from the refresh scheduler (T03): it only
 * knows how to build a model from DB rows. The refresh entrypoint decides
 * when to call it.
 *
 * Embedding format: pgvector string "[0.1,0.2,...]" stored in learning_memories.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import { positiveIntegerBound } from "../lib/bounds.ts";
import type { SuggestionClusterStore, SuggestionClusterModel } from "./suggestion-cluster-store.ts";
import { hdbscan } from "./hdbscan.ts";
import { meanEmbedding, parsePgVectorEmbedding } from "./embedding-vector.ts";

// ── Constants ─────────────────────────────────────────────────────────

/** Minimum members per cluster to include centroid in model. */
export const MIN_CLUSTER_MEMBERS = 3;

/** Minimum total rows per outcome class to attempt clustering at all. */
export const MIN_ROWS_FOR_CLUSTERING = 5;

/** HDBSCAN minClusterSize passed to the algorithm. */
export const HDBSCAN_MIN_CLUSTER_SIZE = 3;

/** Maximum learning memory rows fetched for one model build. */
export const DEFAULT_MAX_INPUT_ROWS = 5_000;

/** Maximum rows per outcome class passed into dense HDBSCAN clustering. */
export const DEFAULT_MAX_ROWS_PER_CLASS_FOR_CLUSTERING = 2_000;

// ── Positive/negative outcome classification ──────────────────────────

/** Outcomes treated as "positive" signal (team values this kind of finding). */
const POSITIVE_OUTCOMES = new Set(["accepted", "thumbs_up"]);

/** Outcomes treated as "negative" signal (team doesn't want this finding). */
const NEGATIVE_OUTCOMES = new Set(["suppressed", "thumbs_down"]);

// ── Types ─────────────────────────────────────────────────────────────

/** Options for building a cluster model for a single repo. */
export type BuildClusterModelOpts = {
  repo: string;
  sql: Sql;
  store: SuggestionClusterStore;
  logger: Logger;
  /** Override HDBSCAN minClusterSize (default: HDBSCAN_MIN_CLUSTER_SIZE). */
  minClusterSize?: number;
  /** Override minimum rows per class needed to cluster (default: MIN_ROWS_FOR_CLUSTERING). */
  minRowsForClustering?: number;
  /** Maximum learning memory rows to fetch and parse (default: DEFAULT_MAX_INPUT_ROWS). */
  maxInputRows?: number;
  /** Maximum rows per outcome class to pass to HDBSCAN (default: DEFAULT_MAX_ROWS_PER_CLASS_FOR_CLUSTERING). */
  maxRowsPerClassForClustering?: number;
};

/** Result of a build attempt. */
export type BuildClusterModelResult = {
  repo: string;
  /** True when a model was built and saved. */
  built: boolean;
  /** If built, the saved model. */
  model: SuggestionClusterModel | null;
  positiveCentroidCount: number;
  negativeCentroidCount: number;
  positiveMemberCount: number;
  negativeMemberCount: number;
  /** Clusters skipped due to insufficient members. */
  skippedClusters: number;
  /** Reason the model was not built (if built=false). */
  skipReason?: string;
};

// ── Embedding helpers ─────────────────────────────────────────────────

/**
 * Parse a pgvector string "[0.1,0.2,...]" into a Float32Array.
 * Returns null on any parse failure.
 */
function parseEmbedding(raw: unknown): Float32Array | null {
  return parsePgVectorEmbedding(raw);
}

// ── Clustering helpers ────────────────────────────────────────────────

type MemoryRow = {
  id: number;
  embedding: Float32Array;
};

/**
 * Run HDBSCAN on a set of embedding rows and return centroids for each
 * cluster that passes the minimum-member threshold.
 *
 * Returns an array of centroids (Float32Array[]), the total member count
 * across accepted clusters, and the number of clusters dropped.
 */
function buildCentroidsFromRows(
  rows: MemoryRow[],
  minClusterSize: number,
  minClusterMembers: number,
  logger: Logger,
  context: string,
): {
  centroids: Float32Array[];
  memberCount: number;
  skippedClusters: number;
} {
  if (rows.length === 0) {
    return { centroids: [], memberCount: 0, skippedClusters: 0 };
  }

  // Convert to number[][] for HDBSCAN (works in reduced or full-dim space)
  const data: number[][] = rows.map((r) => Array.from(r.embedding));

  const result = hdbscan(data, { minClusterSize });

  logger.info(
    {
      context,
      rowCount: rows.length,
      clusterCount: result.clusterCount,
      noiseCount: result.labels.filter((l) => l === -1).length,
    },
    "HDBSCAN clustering complete",
  );

  // Group rows by cluster label
  const clusterMap = new Map<number, MemoryRow[]>();
  for (let i = 0; i < result.labels.length; i++) {
    const label = result.labels[i]!;
    if (label < 0) continue; // noise
    if (!clusterMap.has(label)) clusterMap.set(label, []);
    clusterMap.get(label)!.push(rows[i]!);
  }

  const centroids: Float32Array[] = [];
  let totalMemberCount = 0;
  let skippedClusters = 0;

  for (const [clusterLabel, members] of clusterMap) {
    if (members.length < minClusterMembers) {
      logger.debug(
        { context, clusterLabel, memberCount: members.length, minClusterMembers },
        "Skipping cluster below minimum-member threshold",
      );
      skippedClusters++;
      continue;
    }

    const centroid = meanEmbedding(members.map((m) => m.embedding));
    if (!centroid) {
      logger.warn(
        { context, clusterLabel, memberCount: members.length },
        "Skipping cluster with mixed embedding dimensions",
      );
      skippedClusters++;
      continue;
    }
    centroids.push(centroid);
    totalMemberCount += members.length;
  }

  logger.info(
    {
      context,
      centroidsKept: centroids.length,
      skippedClusters,
      totalMemberCount,
    },
    "Centroid build complete",
  );

  return { centroids, memberCount: totalMemberCount, skippedClusters };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Build and cache a positive/negative cluster model for a repo.
 *
 * Queries learning_memories, splits by outcome class, runs HDBSCAN
 * independently on each, computes centroids, and saves the model via
 * SuggestionClusterStore.
 *
 * Returns a result object describing what was built (or why it was skipped).
 * Never throws — errors are logged and a skip result is returned.
 */
export async function buildClusterModel(
  opts: BuildClusterModelOpts,
): Promise<BuildClusterModelResult> {
  const { repo, sql, store, logger } = opts;
  const minClusterSize = opts.minClusterSize ?? HDBSCAN_MIN_CLUSTER_SIZE;
  const minRows = opts.minRowsForClustering ?? MIN_ROWS_FOR_CLUSTERING;
  const maxInputRows = positiveIntegerBound(opts.maxInputRows, DEFAULT_MAX_INPUT_ROWS);
  const maxRowsPerClassForClustering = positiveIntegerBound(
    opts.maxRowsPerClassForClustering,
    DEFAULT_MAX_ROWS_PER_CLASS_FOR_CLUSTERING,
  );

  const base: BuildClusterModelResult = {
    repo,
    built: false,
    model: null,
    positiveCentroidCount: 0,
    negativeCentroidCount: 0,
    positiveMemberCount: 0,
    negativeMemberCount: 0,
    skippedClusters: 0,
  };

  try {
    // Fetch a recent, outcome-balanced sample so the cap is model policy, not incidental row order.
    const rows = await sql`
      WITH ranked_memories AS (
        SELECT
          id,
          outcome,
          embedding,
          row_number() OVER (
            PARTITION BY CASE
              WHEN outcome IN ('accepted', 'thumbs_up') THEN 'positive'
              ELSE 'negative'
            END
            ORDER BY created_at DESC, id DESC
          ) AS class_rank
        FROM learning_memories
        WHERE repo = ${repo}
          AND stale = false
          AND embedding IS NOT NULL
          AND outcome IN ('accepted', 'thumbs_up', 'suppressed', 'thumbs_down')
      )
      SELECT id, outcome, embedding
      FROM ranked_memories
      WHERE class_rank <= ${Math.ceil(maxInputRows / 2) + 1}
      ORDER BY class_rank ASC, id DESC
      LIMIT ${maxInputRows + 1}
    `;

    const boundedRows = rows.length > maxInputRows ? rows.slice(0, maxInputRows) : rows;

    logger.info(
      { repo, totalRows: boundedRows.length, fetchedRows: rows.length, maxInputRows },
      "Fetched learning memories for cluster model build",
    );
    if (rows.length > maxInputRows) {
      logger.warn(
        { repo, fetchedRows: rows.length, maxInputRows },
        "Capped learning memories before cluster model build",
      );
    }

    // Split by outcome class, parsing embeddings
    const positiveRows: MemoryRow[] = [];
    const negativeRows: MemoryRow[] = [];

    for (const row of boundedRows) {
      const emb = parseEmbedding(row.embedding);
      if (!emb || emb.length === 0) continue;

      const outcome = row.outcome as string;
      if (POSITIVE_OUTCOMES.has(outcome)) {
        positiveRows.push({ id: Number(row.id), embedding: emb });
      } else if (NEGATIVE_OUTCOMES.has(outcome)) {
        negativeRows.push({ id: Number(row.id), embedding: emb });
      }
      // unknown outcome class: ignore
    }

    logger.info(
      {
        repo,
        positiveCount: positiveRows.length,
        negativeCount: negativeRows.length,
      },
      "Outcome class split complete",
    );

    const boundedPositiveRows = positiveRows.length > maxRowsPerClassForClustering
      ? positiveRows.slice(0, maxRowsPerClassForClustering)
      : positiveRows;
    const boundedNegativeRows = negativeRows.length > maxRowsPerClassForClustering
      ? negativeRows.slice(0, maxRowsPerClassForClustering)
      : negativeRows;

    if (boundedPositiveRows.length < positiveRows.length) {
      logger.warn(
        {
          repo,
          outcomeClass: "positive",
          rowCount: positiveRows.length,
          maxRowsPerClassForClustering,
        },
        "Capped outcome class before HDBSCAN clustering",
      );
    }
    if (boundedNegativeRows.length < negativeRows.length) {
      logger.warn(
        {
          repo,
          outcomeClass: "negative",
          rowCount: negativeRows.length,
          maxRowsPerClassForClustering,
        },
        "Capped outcome class before HDBSCAN clustering",
      );
    }

    // Require at least one class to have enough rows to proceed
    const hasSufficientData =
      boundedPositiveRows.length >= minRows || boundedNegativeRows.length >= minRows;

    if (!hasSufficientData) {
      const skipReason =
        `Insufficient data: positive=${boundedPositiveRows.length}, negative=${boundedNegativeRows.length}, ` +
        `minRowsForClustering=${minRows}`;
      logger.info({ repo, skipReason }, "Skipping cluster model build (insufficient data)");
      return { ...base, skipReason };
    }

    // Build centroids per class
    const posResult = boundedPositiveRows.length >= minRows
      ? buildCentroidsFromRows(
          boundedPositiveRows,
          minClusterSize,
          MIN_CLUSTER_MEMBERS,
          logger,
          `${repo}/positive`,
        )
      : { centroids: [], memberCount: 0, skippedClusters: 0 };

    const negResult = boundedNegativeRows.length >= minRows
      ? buildCentroidsFromRows(
          boundedNegativeRows,
          minClusterSize,
          MIN_CLUSTER_MEMBERS,
          logger,
          `${repo}/negative`,
        )
      : { centroids: [], memberCount: 0, skippedClusters: 0 };

    const totalSkipped = posResult.skippedClusters + negResult.skippedClusters;
    const totalMemberCount = posResult.memberCount + negResult.memberCount;

    // Save model (even if one class has zero centroids — cold-start aware)
    const model = await store.saveModel({
      repo,
      positiveCentroids: posResult.centroids,
      negativeCentroids: negResult.centroids,
      memberCount: totalMemberCount,
      positiveMemberCount: posResult.memberCount,
      negativeMemberCount: negResult.memberCount,
    });

    logger.info(
      {
        repo,
        positiveCentroidCount: posResult.centroids.length,
        negativeCentroidCount: negResult.centroids.length,
        positiveMemberCount: posResult.memberCount,
        negativeMemberCount: negResult.memberCount,
        totalMemberCount,
        skippedClusters: totalSkipped,
        modelId: model.id,
      },
      "Cluster model built and saved",
    );

    return {
      repo,
      built: true,
      model,
      positiveCentroidCount: posResult.centroids.length,
      negativeCentroidCount: negResult.centroids.length,
      positiveMemberCount: posResult.memberCount,
      negativeMemberCount: negResult.memberCount,
      skippedClusters: totalSkipped,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, repo }, "Cluster model build failed");
    return {
      ...base,
      skipReason: `Build error: ${message}`,
    };
  }
}
