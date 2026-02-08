import type { Logger } from "pino";

/** Options for creating a workspace (clone target) */
export interface CloneOptions {
  owner: string;
  repo: string;
  ref: string;         // branch name to checkout
  depth?: number;      // shallow clone depth (default: 1)
}

/** An ephemeral workspace with a cloned repo */
export interface Workspace {
  /** Absolute path to the cloned repo directory */
  dir: string;
  /** Clean up the workspace directory. Idempotent, never throws. */
  cleanup(): Promise<void>;
}

/** Job queue with per-installation concurrency control */
export interface JobQueue {
  /** Enqueue a job for an installation. Returns a Promise resolving to the job result. */
  enqueue<T>(installationId: number, fn: () => Promise<T>): Promise<T>;
  /** Number of waiting (not yet running) jobs for an installation */
  getQueueSize(installationId: number): number;
  /** Number of currently running jobs for an installation */
  getPendingCount(installationId: number): number;
}

/** Workspace manager creates and cleans up ephemeral workspaces */
export interface WorkspaceManager {
  /** Create a workspace: temp dir + shallow clone with git auth */
  create(installationId: number, options: CloneOptions): Promise<Workspace>;
  /** Remove any stale kodiai-* temp dirs from previous runs (startup defense-in-depth) */
  cleanupStale(): Promise<number>;
}
