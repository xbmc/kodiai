import type { Logger } from "pino";
import type { ExecutorPhaseTiming, ReviewPhaseStatus } from "./types.ts";

/**
 * Executor phase-timing construction and validation.
 *
 * Lives apart from executor.ts because it is pure data-shaping with no
 * dependency on the execution flow: the remote agent reports its own timings
 * in an untrusted result payload, and normalizing that payload (rejecting
 * anything malformed back to the locally-measured fallback) is a self-contained
 * concern worth reading and testing on its own.
 */

export function buildExecutorPhaseTiming(params: {
  name: ExecutorPhaseTiming["name"];
  status: ReviewPhaseStatus;
  durationMs?: number;
  detail?: string;
}): ExecutorPhaseTiming {
  return {
    name: params.name,
    status: params.status,
    ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
    ...(params.detail ? { detail: params.detail } : {}),
  };
}

export function buildExecutorPhaseTimings(params: {
  handoffStatus: ReviewPhaseStatus;
  handoffDurationMs?: number;
  handoffDetail?: string;
  remoteRuntimeStatus: ReviewPhaseStatus;
  remoteRuntimeDurationMs?: number;
  remoteRuntimeDetail?: string;
}): ExecutorPhaseTiming[] {
  return [
    buildExecutorPhaseTiming({
      name: "executor handoff",
      status: params.handoffStatus,
      durationMs: params.handoffDurationMs,
      detail: params.handoffDetail,
    }),
    buildExecutorPhaseTiming({
      name: "remote runtime",
      status: params.remoteRuntimeStatus,
      durationMs: params.remoteRuntimeDurationMs,
      detail: params.remoteRuntimeDetail,
    }),
  ];
}

function isReviewPhaseStatus(value: unknown): value is ReviewPhaseStatus {
  return value === "completed" || value === "degraded" || value === "unavailable";
}

export function normalizeExecutorPhaseTimingsFromResult(params: {
  candidate: unknown;
  fallback: ExecutorPhaseTiming[];
  logger: Logger;
}): ExecutorPhaseTiming[] {
  const { candidate, fallback, logger } = params;

  if (candidate === undefined) {
    return fallback;
  }

  if (!Array.isArray(candidate)) {
    logger.warn("Ignoring malformed executor phase timings from remote result");
    return fallback;
  }

  const normalizedByName = new Map<ExecutorPhaseTiming["name"], ExecutorPhaseTiming>();

  for (const entry of candidate) {
    if (!entry || typeof entry !== "object") {
      logger.warn("Ignoring malformed executor phase timings from remote result");
      return fallback;
    }

    const name = (entry as { name?: unknown }).name;
    const status = (entry as { status?: unknown }).status;
    const durationMs = (entry as { durationMs?: unknown }).durationMs;
    const detail = (entry as { detail?: unknown }).detail;

    if (
      (name !== "executor handoff" && name !== "remote runtime") ||
      !isReviewPhaseStatus(status) ||
      (durationMs !== undefined &&
        (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0)) ||
      (detail !== undefined && typeof detail !== "string")
    ) {
      logger.warn("Ignoring malformed executor phase timings from remote result");
      return fallback;
    }

    normalizedByName.set(
      name,
      buildExecutorPhaseTiming({
        name,
        status,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(detail ? { detail } : {}),
      }),
    );
  }

  return fallback.map((phase) => normalizedByName.get(phase.name) ?? phase);
}
