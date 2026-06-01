import type { ReviewPhaseName, ReviewPhaseStatus, ReviewPhaseTiming } from "../execution/types.ts";

const REVIEW_DETAILS_PHASE_ORDER = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const satisfies ReadonlyArray<ReviewPhaseName>;

export type ReviewDetailsPhaseTimingSummary = {
  totalDurationMs?: number;
  phases?: ReadonlyArray<ReviewPhaseTiming> | null;
};

function isFiniteNonNegativeDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isReviewDetailsPhaseName(value: unknown): value is ReviewPhaseName {
  return typeof value === "string"
    && (REVIEW_DETAILS_PHASE_ORDER as ReadonlyArray<string>).includes(value);
}

function isReviewDetailsPhaseStatus(value: unknown): value is ReviewPhaseStatus {
  return value === "completed" || value === "degraded" || value === "unavailable";
}

function formatReviewDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  if (durationMs < 60_000) {
    return `${Math.round(durationMs / 1000)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function normalizeReviewDetailsPhase(phase: unknown): ReviewPhaseTiming | null {
  if (typeof phase !== "object" || phase === null) {
    return null;
  }

  const candidate = phase as {
    name?: unknown;
    status?: unknown;
    durationMs?: unknown;
    detail?: unknown;
  };

  if (!isReviewDetailsPhaseName(candidate.name)) {
    return null;
  }

  if (!isReviewDetailsPhaseStatus(candidate.status)) {
    return {
      name: candidate.name,
      status: "unavailable",
      detail: "invalid phase timing data",
    };
  }

  const detail = typeof candidate.detail === "string" && candidate.detail.trim().length > 0
    ? candidate.detail.trim()
    : undefined;

  if (candidate.status === "unavailable") {
    return {
      name: candidate.name,
      status: "unavailable",
      ...(detail ? { detail } : {}),
    };
  }

  if (!isFiniteNonNegativeDuration(candidate.durationMs)) {
    return {
      name: candidate.name,
      status: "unavailable",
      detail: "invalid phase timing data",
    };
  }

  return {
    name: candidate.name,
    status: candidate.status,
    durationMs: candidate.durationMs,
    ...(detail ? { detail } : {}),
  };
}

function formatReviewDetailsPhaseLine(phase: ReviewPhaseTiming): string {
  if (phase.status === "unavailable") {
    return `  - ${phase.name}: unavailable${phase.detail ? ` (${phase.detail})` : ""}`;
  }

  const durationText = isFiniteNonNegativeDuration(phase.durationMs)
    ? formatReviewDuration(phase.durationMs)
    : "unavailable";

  if (phase.status === "degraded") {
    return `  - ${phase.name}: ${durationText}${phase.detail ? ` (degraded: ${phase.detail})` : " (degraded)"}`;
  }

  return `  - ${phase.name}: ${durationText}`;
}

export function formatReviewDetailsPhaseTimingSummary(summary?: ReviewDetailsPhaseTimingSummary | null): string[] {
  if (!summary) {
    return [];
  }

  const phaseMap = new Map<ReviewPhaseName, ReviewPhaseTiming>();
  if (Array.isArray(summary.phases)) {
    for (const phase of summary.phases) {
      const normalized = normalizeReviewDetailsPhase(phase);
      if (normalized && !phaseMap.has(normalized.name)) {
        phaseMap.set(normalized.name, normalized);
      }
    }
  }

  const lines: string[] = [];
  if (isFiniteNonNegativeDuration(summary.totalDurationMs)) {
    lines.push(`- Total wall-clock: ${formatReviewDuration(summary.totalDurationMs)}`);
  }

  lines.push("- Phase timings:");

  for (const name of REVIEW_DETAILS_PHASE_ORDER) {
    const phase = phaseMap.get(name) ?? {
      name,
      status: "unavailable",
      detail: "phase timing unavailable",
    } satisfies ReviewPhaseTiming;
    lines.push(formatReviewDetailsPhaseLine(phase));
  }

  return lines;
}
