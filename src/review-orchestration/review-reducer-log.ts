import type { Logger } from "pino";
import type { ReviewReducerResult } from "./review-reducer.ts";

export function hasTrustedReviewReducerCounts(value: unknown): value is ReviewReducerResult["counts"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const counts = value as Record<string, unknown>;
  return [
    "input",
    "kept",
    "suppressed",
    "rewritten",
    "deprioritized",
    "lowConfidence",
    "auditEvents",
    "severityDemoted",
    "graphValidated",
    "graphUncertain",
  ].every((key) => typeof counts[key] === "number" && Number.isFinite(counts[key]) && counts[key] >= 0);
}

export function isTrustedReviewReducerResult(value: unknown): value is ReviewReducerResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewReducerResult>;
  return (candidate.status === "ready" || candidate.status === "degraded")
    && Array.isArray(candidate.findings)
    && Array.isArray(candidate.visibleFindings)
    && Array.isArray(candidate.filteredInlineFindings)
    && Array.isArray(candidate.lowConfidenceFindings)
    && candidate.suppressionMatchCounts instanceof Map
    && Array.isArray(candidate.filterRecords)
    && hasTrustedReviewReducerCounts(candidate.counts)
    && Array.isArray(candidate.audit)
    && typeof candidate.detailsSummary === "object"
    && candidate.detailsSummary !== null
    && typeof candidate.detailsSummary.text === "string";
}

export function logReviewReducerResult(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  reducerResult: ReviewReducerResult;
  graphValidationEnabled: boolean;
}): void {
  const { logger, baseLog, reducerResult, graphValidationEnabled } = params;
  const logPayload = {
    ...baseLog,
    gate: "review-reducer",
    gateResult: reducerResult.status,
    status: reducerResult.status,
    reason: reducerResult.reason,
    counts: reducerResult.counts,
    graphValidation: {
      enabled: graphValidationEnabled,
      graphValidated: reducerResult.counts.graphValidated,
      graphUncertain: reducerResult.counts.graphUncertain,
    },
  };

  if (reducerResult.status === "degraded") {
    logger.warn(logPayload, "Review reducer degraded (fail-open, destructive cleanup disabled)");
    return;
  }

  logger.info(logPayload, "Review reducer completed");
}
