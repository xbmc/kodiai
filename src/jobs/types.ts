import type { Logger } from "pino";

/** Options for creating a workspace (clone target) */
export interface CloneOptions {
  owner: string;
  repo: string;
  ref: string;         // branch name to checkout
  depth?: number;      // shallow clone depth (default: 1)
  /** If provided, clone from the fork instead of the target repo. */
  forkContext?: {
    forkOwner: string;
    forkRepo: string;
    botPat: string;
  };
}

/** An ephemeral workspace with a cloned repo */
export interface Workspace {
  /** Absolute path to the cloned repo directory */
  dir: string;
  /** Clean up the workspace directory. Idempotent, never throws. */
  cleanup(): Promise<void>;
  /**
   * Installation token (or bot PAT for fork clones) for auth operations.
   * Stored in memory only — never written to disk after workspace.create() strips it from remotes.
   */
  token?: string;
}

export interface JobQueueWaitMetadata {
  queuedAtMs: number;
  startedAtMs: number;
  waitMs: number;
}

export type JobLane = "interactive-review" | "review" | "sync";

export interface JobSnapshot {
  jobId: string;
  installationId: number;
  lane: JobLane;
  key: string;
  jobType?: string;
  deliveryId?: string;
  prNumber?: number;
  phase: string;
  queuedAtMs: number;
  startedAtMs?: number;
  lastProgressAtMs: number;
}

export interface JobQueueRunMetadata extends JobQueueWaitMetadata {
  jobId: string;
  lane: JobLane;
  key: string;
  setPhase(phase: string): void;
}

export interface JobQueueContext {
  lane?: JobLane;
  key?: string;
  deliveryId?: string;
  eventName?: string;
  action?: string;
  jobType?: string;
  prNumber?: number;
}

/** Job queue with per-installation concurrency control */
export interface JobQueue {
  /** Enqueue a job for an installation. Returns a Promise resolving to the job result. */
  enqueue<T>(
    installationId: number,
    fn: (metadata: JobQueueRunMetadata) => Promise<T>,
    context?: JobQueueContext,
  ): Promise<T>;
  /** Number of waiting (not yet running) jobs for an installation */
  getQueueSize(installationId: number): number;
  /** Number of currently running jobs for an installation */
  getPendingCount(installationId: number): number;
  /** Active queued/running jobs for an installation, sorted by queuedAtMs. */
  getActiveJobs(installationId: number): JobSnapshot[];
}

/** Workspace manager creates and cleans up ephemeral workspaces */
export interface WorkspaceManager {
  /** Create a workspace: temp dir + shallow clone with git auth */
  create(installationId: number, options: CloneOptions): Promise<Workspace>;
  /** Remove any stale kodiai-* temp dirs from previous runs (startup defense-in-depth) */
  cleanupStale(): Promise<number>;
}
