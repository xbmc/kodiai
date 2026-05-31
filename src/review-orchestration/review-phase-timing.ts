import type {
  ExecutorPhaseTiming,
  ReviewPhaseName,
  ReviewPhaseTiming,
} from "../execution/types.ts";
import type { JobQueueWaitMetadata } from "../jobs/types.ts";
import type { TimeoutBudgetDetails } from "../lib/review-utils.ts";

export const REVIEW_PHASE_ORDER = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const satisfies ReadonlyArray<ReviewPhaseName>;

export function createReviewPhaseTiming(params: {
  name: ReviewPhaseName;
  status: ReviewPhaseTiming["status"];
  durationMs?: number;
  detail?: string;
}): ReviewPhaseTiming {
  return {
    name: params.name,
    status: params.status,
    ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
    ...(params.detail ? { detail: params.detail } : {}),
  };
}

export function buildUnavailableReviewPhase(name: ReviewPhaseName, detail: string): ReviewPhaseTiming {
  return createReviewPhaseTiming({
    name,
    status: "unavailable",
    detail,
  });
}

export function isValidQueueWaitMetadata(metadata?: JobQueueWaitMetadata): metadata is JobQueueWaitMetadata {
  return Boolean(
    metadata &&
    Number.isFinite(metadata.queuedAtMs) &&
    Number.isFinite(metadata.startedAtMs) &&
    Number.isFinite(metadata.waitMs) &&
    metadata.queuedAtMs >= 0 &&
    metadata.startedAtMs >= metadata.queuedAtMs &&
    metadata.waitMs >= 0 &&
    metadata.startedAtMs - metadata.queuedAtMs === metadata.waitMs,
  );
}

export function buildQueueWaitPhase(metadata?: JobQueueWaitMetadata): ReviewPhaseTiming {
  if (!isValidQueueWaitMetadata(metadata)) {
    return buildUnavailableReviewPhase("queue wait", "invalid queue wait metadata");
  }

  return createReviewPhaseTiming({
    name: "queue wait",
    status: "completed",
    durationMs: metadata.waitMs,
  });
}

export function formatTimeoutErrorDetail(params: {
  totalTimeoutSeconds: number;
  complexityInfo: string;
  hasReviewOutput: boolean;
  timeoutEstimate?: TimeoutBudgetDetails | null;
}): string {
  const summary = params.hasReviewOutput
    ? "Timed out after partial review output."
    : "Timed out with no review output.";

  const budgetDetail = params.timeoutEstimate
    ? `Timeout budget: remote runtime ${params.timeoutEstimate.remoteRuntimeBudgetSeconds}s + infra overhead ${params.timeoutEstimate.infraOverheadBudgetSeconds}s = total ${params.timeoutEstimate.totalTimeoutSeconds}s.`
    : `Timed out after ${params.totalTimeoutSeconds}s.`;

  return `${summary} ${budgetDetail} PR complexity: ${params.complexityInfo}`;
}

export function buildExecutorUnavailablePhases(detail: string): ExecutorPhaseTiming[] {
  return [
    createReviewPhaseTiming({
      name: "executor handoff",
      status: "unavailable",
      detail,
    }) as ExecutorPhaseTiming,
    createReviewPhaseTiming({
      name: "remote runtime",
      status: "unavailable",
      detail,
    }) as ExecutorPhaseTiming,
  ];
}

export function buildOrderedReviewPhaseSummary(phases: Map<ReviewPhaseName, ReviewPhaseTiming>): ReviewPhaseTiming[] {
  return REVIEW_PHASE_ORDER.map((name) =>
    phases.get(name) ?? buildUnavailableReviewPhase(name, "phase timing unavailable"));
}

export function buildReviewDetailsPhaseTimingSummary(params: {
  phases: Map<ReviewPhaseName, ReviewPhaseTiming>;
  publicationPhaseStartedAt?: number;
  totalPhaseStartAt?: number;
  now?: () => number;
}) {
  const nowFn = params.now ?? (() => Date.now());
  const phaseSnapshot = new Map(params.phases);

  if (!phaseSnapshot.has("publication")) {
    if (params.publicationPhaseStartedAt !== undefined) {
      phaseSnapshot.set(
        "publication",
        createReviewPhaseTiming({
          name: "publication",
          status: "degraded",
          durationMs: Math.max(0, nowFn() - params.publicationPhaseStartedAt),
          detail: "captured before publication completed",
        }),
      );
    } else {
      phaseSnapshot.set(
        "publication",
        buildUnavailableReviewPhase("publication", "phase timing unavailable"),
      );
    }
  }

  const totalDurationMs =
    typeof params.totalPhaseStartAt === "number" &&
      Number.isFinite(params.totalPhaseStartAt) &&
      params.totalPhaseStartAt > 0
      ? Math.max(0, nowFn() - params.totalPhaseStartAt)
      : undefined;

  return {
    ...(typeof totalDurationMs === "number" ? { totalDurationMs } : {}),
    phases: buildOrderedReviewPhaseSummary(phaseSnapshot),
  };
}
