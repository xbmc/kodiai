/**
 * Cluster store: PostgreSQL-backed CRUD for review pattern clusters,
 * assignments, and pipeline run state.
 *
 * Follows the createXxxStore factory pattern from review-comment-store.ts.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  ReviewCluster,
  ClusterAssignment,
  ClusterRunState,
  ClusterStore,
} from "./cluster-types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert Float32Array to pgvector string: [0.1,0.2,...] */
function float32ArrayToVectorString(arr: Float32Array): string {
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    parts[i] = String(arr[i]);
  }
  return `[${parts.join(",")}]`;
}

/** Parse pgvector string back to Float32Array. */
function parseVectorToFloat32Array(vec: unknown): Float32Array {
  if (vec instanceof Float32Array) return vec;
  if (typeof vec === "string") {
    // pgvector format: [0.1,0.2,...]
    const nums = vec
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map(Number);
    return new Float32Array(nums);
  }
  // Fallback: return empty
  return new Float32Array(0);
}

type ClusterRow = {
  id: number;
  created_at: string;
  updated_at: string;
  repo: string;
  slug: string;
  label: string;
  centroid: unknown;
  member_count: number;
  member_count_at_label: number;
  file_paths: string[] | string;
  label_updated_at: string;
  pinned: boolean;
  retired: boolean;
};

function rowToCluster(row: ClusterRow): ReviewCluster {
  return {
    id: row.id,
    repo: row.repo,
    slug: row.slug,
    label: row.label,
    centroid: parseVectorToFloat32Array(row.centroid),
    memberCount: row.member_count,
    memberCountAtLabel: row.member_count_at_label,
    filePaths: Array.isArray(row.file_paths)
      ? row.file_paths
      : typeof row.file_paths === "string"
        ? (row.file_paths as string).replace(/^\{/, "").replace(/\}$/, "").split(",").filter(Boolean)
        : [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    labelUpdatedAt: new Date(row.label_updated_at),
    pinned: row.pinned,
    retired: row.retired,
  };
}

type AssignmentRow = {
  id: number;
  cluster_id: number;
  review_comment_id: number;
  probability: number;
  assigned_at: string;
};

function rowToAssignment(row: AssignmentRow): ClusterAssignment {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    reviewCommentId: row.review_comment_id,
    probability: row.probability,
    assignedAt: new Date(row.assigned_at),
  };
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create a cluster store backed by PostgreSQL.
 * Follows the same factory pattern as createReviewCommentStore.
 */
export function createClusterStore(opts: {
  sql: Sql;
  logger: Logger;
}): ClusterStore {
  const { sql, logger } = opts;

  const store: ClusterStore = {
    async upsertCluster(
      cluster: Omit<ReviewCluster, "id" | "createdAt" | "updatedAt">,
    ): Promise<ReviewCluster> {
      const centroidValue = cluster.centroid.length > 0
        ? float32ArrayToVectorString(cluster.centroid)
        : null;

      const rows = await sql`
        INSERT INTO review_clusters (
          repo, slug, label, centroid,
          member_count, member_count_at_label, file_paths,
          label_updated_at, pinned, retired
        ) VALUES (
          ${cluster.repo}, ${cluster.slug}, ${cluster.label},
          ${centroidValue}::vector,
          ${cluster.memberCount}, ${cluster.memberCountAtLabel},
          ${cluster.filePaths}::text[],
          ${cluster.labelUpdatedAt}, ${cluster.pinned}, ${cluster.retired}
        )
        ON CONFLICT (repo, slug) DO UPDATE SET
          label = EXCLUDED.label,
          centroid = EXCLUDED.centroid,
          member_count = EXCLUDED.member_count,
          file_paths = EXCLUDED.file_paths,
          updated_at = now(),
          label_updated_at = CASE
            WHEN review_clusters.pinned THEN review_clusters.label_updated_at
            ELSE EXCLUDED.label_updated_at
          END,
          retired = EXCLUDED.retired
        RETURNING *
      `;

      return rowToCluster(rows[0] as unknown as ClusterRow);
    },

    async getActiveClusters(repo: string): Promise<ReviewCluster[]> {
      const rows = await sql`
        SELECT * FROM review_clusters
        WHERE repo = ${repo} AND retired = false
        ORDER BY member_count DESC
      `;
      return rows.map((r) => rowToCluster(r as unknown as ClusterRow));
    },

    async retireCluster(clusterId: number): Promise<void> {
      await sql`
        UPDATE review_clusters
        SET retired = true, updated_at = now()
        WHERE id = ${clusterId}
      `;
    },

    async updateClusterLabel(
      clusterId: number,
      slug: string,
      label: string,
      memberCount: number,
    ): Promise<void> {
      // Skip if pinned
      await sql`
        UPDATE review_clusters
        SET slug = ${slug},
            label = ${label},
            member_count_at_label = ${memberCount},
            label_updated_at = now(),
            updated_at = now()
        WHERE id = ${clusterId} AND pinned = false
      `;
    },

    async pinClusterLabel(
      clusterId: number,
      slug: string,
      label: string,
    ): Promise<void> {
      await sql`
        UPDATE review_clusters
        SET slug = ${slug},
            label = ${label},
            pinned = true,
            label_updated_at = now(),
            updated_at = now()
        WHERE id = ${clusterId}
      `;
    },

    async writeAssignments(
      assignments: Omit<ClusterAssignment, "id" | "assignedAt">[],
    ): Promise<void> {
      if (assignments.length === 0) return;

      for (const a of assignments) {
        try {
          await sql`
            INSERT INTO review_cluster_assignments (
              cluster_id, review_comment_id, probability
            ) VALUES (
              ${a.clusterId}, ${a.reviewCommentId}, ${a.probability}
            )
            ON CONFLICT (cluster_id, review_comment_id) DO NOTHING
          `;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(
            { err: message, clusterId: a.clusterId, reviewCommentId: a.reviewCommentId },
            "Failed to write cluster assignment",
          );
        }
      }
    },

    async clearAssignments(clusterId: number): Promise<void> {
      await sql`
        DELETE FROM review_cluster_assignments
        WHERE cluster_id = ${clusterId}
      `;
    },

    async getAssignmentsByCluster(
      clusterId: number,
    ): Promise<ClusterAssignment[]> {
      const rows = await sql`
        SELECT * FROM review_cluster_assignments
        WHERE cluster_id = ${clusterId}
        ORDER BY probability DESC
      `;
      return rows.map((r) => rowToAssignment(r as unknown as AssignmentRow));
    },

    async getRunState(): Promise<ClusterRunState> {
      const rows = await sql`SELECT * FROM cluster_run_state WHERE id = 1`;
      if (rows.length === 0) {
        return {
          lastRunAt: null,
          clustersDiscovered: 0,
          commentsProcessed: 0,
          labelsGenerated: 0,
          status: "pending",
          errorMessage: null,
        };
      }
      const row = rows[0]!;
      return {
        id: row.id as number,
        lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
        clustersDiscovered: row.clusters_discovered as number,
        commentsProcessed: row.comments_processed as number,
        labelsGenerated: row.labels_generated as number,
        status: row.status as ClusterRunState["status"],
        errorMessage: (row.error_message as string) ?? null,
        updatedAt: row.updated_at as string,
      };
    },

    async saveRunState(state: ClusterRunState): Promise<void> {
      await sql`
        INSERT INTO cluster_run_state (
          id, last_run_at, clusters_discovered, comments_processed,
          labels_generated, status, error_message, updated_at
        ) VALUES (
          1, ${state.lastRunAt}, ${state.clustersDiscovered},
          ${state.commentsProcessed}, ${state.labelsGenerated},
          ${state.status}, ${state.errorMessage}, now()
        )
        ON CONFLICT (id) DO UPDATE SET
          last_run_at = EXCLUDED.last_run_at,
          clusters_discovered = EXCLUDED.clusters_discovered,
          comments_processed = EXCLUDED.comments_processed,
          labels_generated = EXCLUDED.labels_generated,
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          updated_at = now()
      `;
    },
  };

  logger.debug("ClusterStore initialized");
  return store;
}
