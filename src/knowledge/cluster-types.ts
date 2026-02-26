/**
 * Type definitions for review pattern clustering: HDBSCAN algorithm,
 * cluster records, assignments, matching, and pipeline state.
 */

import type { Sql } from "../db/client.ts";
import type { TaskRouter } from "../llm/task-router.ts";
import type { Logger } from "pino";

// ── HDBSCAN Algorithm Types ──────────────────────────────────────────

/** HDBSCAN algorithm result. */
export type HdbscanResult = {
  /** Cluster label per point: -1 = noise, 0+ = cluster ID. */
  labels: number[];
  /** Membership strength per point: 0..1. */
  probabilities: number[];
  /** Number of clusters discovered (excluding noise). */
  clusterCount: number;
};

/** HDBSCAN configuration. */
export type HdbscanOptions = {
  /** Minimum members to form a cluster. */
  minClusterSize: number;
  /** Core distance samples (defaults to minClusterSize). */
  minSamples?: number;
};

// ── Cluster Records ──────────────────────────────────────────────────

/** A discovered review pattern cluster. */
export type ReviewCluster = {
  id: number;
  repo: string;
  /** Short technical slug (e.g., "null-check-missing"). */
  slug: string;
  /** Natural language description. */
  label: string;
  /** Mean embedding of cluster members (1024-dim). */
  centroid: Float32Array;
  /** Current member count. */
  memberCount: number;
  /** Member count when label was last generated. */
  memberCountAtLabel: number;
  /** Unique file paths across cluster members. */
  filePaths: string[];
  createdAt: Date;
  updatedAt: Date;
  labelUpdatedAt: Date;
  /** Manual label override (never auto-regenerate when true). */
  pinned: boolean;
  /** Below threshold, not surfaced in reviews. */
  retired: boolean;
};

/** Assignment of a review comment to a cluster. */
export type ClusterAssignment = {
  id: number;
  clusterId: number;
  /** FK to review_comments.id. */
  reviewCommentId: number;
  /** HDBSCAN membership probability. */
  probability: number;
  assignedAt: Date;
};

// ── Pattern Matching ─────────────────────────────────────────────────

/** Match result when checking PR against active clusters. */
export type ClusterPatternMatch = {
  clusterId: number;
  slug: string;
  label: string;
  memberCount: number;
  /** Cosine similarity to cluster centroid. */
  similarityScore: number;
  /** Fraction of cluster file paths matching PR files. */
  filePathOverlap: number;
  /** Weighted combination of similarity + file overlap. */
  combinedScore: number;
  /** One example comment for context. */
  representativeSample: string;
};

// ── Pipeline State ───────────────────────────────────────────────────

/** Run state for cluster refresh pipeline. */
export type ClusterRunState = {
  id?: number;
  lastRunAt: Date | null;
  clustersDiscovered: number;
  commentsProcessed: number;
  labelsGenerated: number;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage: string | null;
  updatedAt?: string;
};

// ── Store Interface ──────────────────────────────────────────────────

/** Cluster store interface for CRUD operations. */
export type ClusterStore = {
  /** Upsert a cluster (ON CONFLICT by repo+slug). */
  upsertCluster(
    cluster: Omit<ReviewCluster, "id" | "createdAt" | "updatedAt">,
  ): Promise<ReviewCluster>;

  /** Get all active (non-retired) clusters for a repo. */
  getActiveClusters(repo: string): Promise<ReviewCluster[]>;

  /** Mark a cluster as retired. */
  retireCluster(clusterId: number): Promise<void>;

  /** Update cluster label (skips if pinned). */
  updateClusterLabel(
    clusterId: number,
    slug: string,
    label: string,
    memberCount: number,
  ): Promise<void>;

  /** Pin a cluster label (manual override, never auto-regenerated). */
  pinClusterLabel(clusterId: number, slug: string, label: string): Promise<void>;

  /** Bulk write assignments (ON CONFLICT DO NOTHING). */
  writeAssignments(
    assignments: Omit<ClusterAssignment, "id" | "assignedAt">[],
  ): Promise<void>;

  /** Clear all assignments for a cluster. */
  clearAssignments(clusterId: number): Promise<void>;

  /** Get assignments for a cluster, ordered by probability DESC. */
  getAssignmentsByCluster(clusterId: number): Promise<ClusterAssignment[]>;

  /** Get pipeline run state. */
  getRunState(): Promise<ClusterRunState>;

  /** Save pipeline run state (upsert singleton). */
  saveRunState(state: ClusterRunState): Promise<void>;
};

// ── Scheduler Interface ──────────────────────────────────────────────

/** Cluster scheduler interface. */
export type ClusterScheduler = {
  start(): void;
  stop(): void;
  runNow(): Promise<void>;
};

// ── Pipeline Options ─────────────────────────────────────────────────

/** Options for creating the cluster pipeline. */
export type ClusterPipelineOptions = {
  sql: Sql;
  taskRouter: TaskRouter;
  logger: Logger;
};
