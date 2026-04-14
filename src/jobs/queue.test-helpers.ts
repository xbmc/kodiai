import type { JobQueue, JobQueueRunMetadata } from "./types.ts";

/** Test-only helpers for stubbing JobQueue in unit tests. */
export function createQueueRunMetadata(
  overrides: Partial<JobQueueRunMetadata> = {},
): JobQueueRunMetadata {
  return {
    queuedAtMs: 1_000,
    startedAtMs: 1_250,
    waitMs: 250,
    jobId: "job-1",
    lane: "review",
    key: "test-job",
    setPhase: () => undefined,
    ...overrides,
  };
}

export const getEmptyActiveJobs: JobQueue["getActiveJobs"] = () => [];
