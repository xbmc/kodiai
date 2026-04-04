/**
 * Cluster-model store for per-repo positive/negative suggestion centroids.
 *
 * Each repo has at most one cached model row in `suggestion_cluster_models`.
 * Models are built by the background refresh job (M037/S01/T03) and read
 * by the live review scoring path (M037/S02). The store is intentionally
 * narrow: it only handles model persistence and retrieval — cluster building
 * lives in suggestion-cluster-builder.ts.
 *
 * Centroid persistence format: JSONB arrays of number[] (one per centroid).
 * Float32Arrays are serialized to plain number[] for JSONB storage and
 * deserialized back on read.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";

// ── TTL ───────────────────────────────────────────────────────────────

/** Default model TTL: 24 hours. Refresh job should run before this expires. */
export const CLUSTER_MODEL_TTL_MS = 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────

/**
 * A cached per-repo cluster model holding positive and negative centroids.
 *
 * - `positiveCentroids`: centroids of clusters formed from accepted /
 *   thumbs-up learning memories (signals the team values these patterns).
 * - `negativeCentroids`: centroids of clusters formed from thumbs-down /
 *   suppressed learning memories (signals the team dislikes these patterns).
 * - `memberCount`: total learning-memory rows used to build the model.
 *   Models with memberCount < 5 per centroid cluster should be treated as
 *   cold-start and not used for scoring.
 */
export type SuggestionClusterModel = {
  id: number;
  repo: string;
  positiveCentroids: Float32Array[];
  negativeCentroids: Float32Array[];
  /** Total rows across both outcome classes. */
  memberCount: number;
  /** Rows in the positive (accepted / thumbs-up) class. */
  positiveMemberCount: number;
  /** Rows in the negative (thumbs-down / suppressed) class. */
  negativeMemberCount: number;
  /** Wall-clock time the model was built. */
  builtAt: string;
  /** ISO timestamp after which the model is considered stale. */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Payload for saving or replacing a cluster model.
 */
export type SuggestionClusterModelPayload = {
  repo: string;
  positiveCentroids: Float32Array[];
  negativeCentroids: Float32Array[];
  memberCount: number;
  positiveMemberCount: number;
  negativeMemberCount: number;
  /** If omitted, defaults to now() + CLUSTER_MODEL_TTL_MS. */
  expiresAt?: Date;
};

/**
 * Store interface for cluster-model CRUD.
 */
export type SuggestionClusterStore = {
  /**
   * Read the current cached model for a repo, or null if none exists or the
   * model has expired (caller decides whether to rebuild or use stale data).
   */
  getModel(repo: string): Promise<SuggestionClusterModel | null>;

  /**
   * Read the current model regardless of expiry (for diagnostics / refresh logic).
   */
  getModelIncludingStale(repo: string): Promise<SuggestionClusterModel | null>;

  /**
   * Persist (upsert) a new model for a repo. Replaces any prior row.
   */
  saveModel(payload: SuggestionClusterModelPayload): Promise<SuggestionClusterModel>;

  /**
   * Delete the model for a repo (e.g., when invalidating after schema change).
   */
  deleteModel(repo: string): Promise<void>;

  /**
   * List repos whose models have expired (for the refresh sweep).
   */
  listExpiredModelRepos(limit?: number): Promise<string[]>;
};

// ── Serialization helpers ─────────────────────────────────────────────

/** Convert Float32Array → plain number[] for JSONB storage. */
function centroidToJson(c: Float32Array): number[] {
  return Array.from(c);
}

/** Convert plain number[] back to Float32Array on read. */
function jsonToCentroid(arr: unknown): Float32Array {
  if (Array.isArray(arr)) {
    return new Float32Array(arr as number[]);
  }
  return new Float32Array(0);
}

/** Serialize array of Float32Arrays to a JSONB-compatible string. */
function serializeCentroids(centroids: Float32Array[]): string {
  return JSON.stringify(centroids.map(centroidToJson));
}

/** Deserialize JSONB centroid array back to Float32Array[]. */
function deserializeCentroids(raw: unknown): Float32Array[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map(jsonToCentroid);
}

// ── Row type ──────────────────────────────────────────────────────────

type ModelRow = {
  id: number | string;
  repo: string;
  positive_centroids: unknown;
  negative_centroids: unknown;
  member_count: number | string;
  positive_member_count: number | string;
  negative_member_count: number | string;
  built_at: string | Date;
  expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

function toIso(v: string | Date): string {
  return typeof v === "string" ? v : v.toISOString();
}

function rowToModel(row: ModelRow): SuggestionClusterModel {
  return {
    id: Number(row.id),
    repo: row.repo,
    positiveCentroids: deserializeCentroids(
      typeof row.positive_centroids === "string"
        ? JSON.parse(row.positive_centroids)
        : row.positive_centroids,
    ),
    negativeCentroids: deserializeCentroids(
      typeof row.negative_centroids === "string"
        ? JSON.parse(row.negative_centroids)
        : row.negative_centroids,
    ),
    memberCount: Number(row.member_count),
    positiveMemberCount: Number(row.positive_member_count),
    negativeMemberCount: Number(row.negative_member_count),
    builtAt: toIso(row.built_at),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// ── Factory ───────────────────────────────────────────────────────────

export function createSuggestionClusterStore(opts: {
  sql: Sql;
  logger: Logger;
}): SuggestionClusterStore {
  const { sql, logger } = opts;

  const store: SuggestionClusterStore = {
    async getModel(repo: string): Promise<SuggestionClusterModel | null> {
      const rows = await sql`
        SELECT *
        FROM suggestion_cluster_models
        WHERE repo = ${repo}
          AND expires_at > now()
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToModel(rows[0] as unknown as ModelRow);
    },

    async getModelIncludingStale(repo: string): Promise<SuggestionClusterModel | null> {
      const rows = await sql`
        SELECT *
        FROM suggestion_cluster_models
        WHERE repo = ${repo}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToModel(rows[0] as unknown as ModelRow);
    },

    async saveModel(payload: SuggestionClusterModelPayload): Promise<SuggestionClusterModel> {
      const expiresAt = payload.expiresAt ?? new Date(Date.now() + CLUSTER_MODEL_TTL_MS);
      const posJson = serializeCentroids(payload.positiveCentroids);
      const negJson = serializeCentroids(payload.negativeCentroids);

      try {
        const rows = await sql`
          INSERT INTO suggestion_cluster_models (
            repo,
            positive_centroids,
            negative_centroids,
            member_count,
            positive_member_count,
            negative_member_count,
            built_at,
            expires_at
          ) VALUES (
            ${payload.repo},
            ${posJson}::jsonb,
            ${negJson}::jsonb,
            ${payload.memberCount},
            ${payload.positiveMemberCount},
            ${payload.negativeMemberCount},
            now(),
            ${expiresAt.toISOString()}
          )
          ON CONFLICT (repo) DO UPDATE SET
            positive_centroids   = EXCLUDED.positive_centroids,
            negative_centroids   = EXCLUDED.negative_centroids,
            member_count         = EXCLUDED.member_count,
            positive_member_count = EXCLUDED.positive_member_count,
            negative_member_count = EXCLUDED.negative_member_count,
            built_at             = now(),
            expires_at           = EXCLUDED.expires_at,
            updated_at           = now()
          RETURNING *
        `;
        return rowToModel(rows[0] as unknown as ModelRow);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { err: message, repo: payload.repo },
          "Failed to save suggestion cluster model",
        );
        throw err;
      }
    },

    async deleteModel(repo: string): Promise<void> {
      await sql`
        DELETE FROM suggestion_cluster_models WHERE repo = ${repo}
      `;
    },

    async listExpiredModelRepos(limit = 50): Promise<string[]> {
      const effectiveLimit = Math.max(1, limit);
      const rows = await sql`
        SELECT repo
        FROM suggestion_cluster_models
        WHERE expires_at <= now()
        ORDER BY expires_at ASC
        LIMIT ${effectiveLimit}
      `;
      return rows.map((r) => (r as { repo: string }).repo);
    },
  };

  logger.debug("SuggestionClusterStore initialized");
  return store;
}
