import { resolveReviewDetailsLineCounts } from "../lib/review-details-formatting.ts";
import type { FindingSeverity } from "../lib/review-finding-metadata.ts";
import type { ReviewCandidatePublicationRuntimeResult } from "../review-orchestration/review-candidate-publication-runtime.ts";
import type { ReviewPlanDetailsSummary } from "../review-orchestration/review-plan.ts";

export type ReviewDetailsRuntimeFinding = {
  severity: FindingSeverity;
  suppressed?: boolean;
};

export type ReviewDetailsFindingCounts = Record<FindingSeverity, number>;

export type ReviewDetailsRuntimeContext = {
  findingCounts: ReviewDetailsFindingCounts;
  suppressionsApplied: number;
  reviewDetailsLineCounts: ReturnType<typeof resolveReviewDetailsLineCounts>;
  linesChanged: number;
  hasReviewDetailsOperationalSignal: boolean;
};

const DEFAULT_BLOCKED_REASONS = new Set([
  "approval-blocked",
  "no-candidate-publication-path",
]);

function hasNonDefaultCandidatePublicationReason(reasons: readonly string[]): boolean {
  return reasons.some((reason) => !DEFAULT_BLOCKED_REASONS.has(reason));
}

export function resolveReviewDetailsRuntimeContext(params: {
  processedFindings: readonly ReviewDetailsRuntimeFinding[];
  filteredInlineFindings: readonly unknown[];
  diffLinesAdded: number;
  diffLinesRemoved: number;
  prApiLinesAdded?: number;
  prApiLinesRemoved?: number;
  reviewPlanDetailsSummary: Pick<ReviewPlanDetailsSummary, "text">;
  reviewCandidatePublicationRuntime: Pick<ReviewCandidatePublicationRuntimeResult, "mode" | "reasons">;
}): ReviewDetailsRuntimeContext {
  const findingCounts: ReviewDetailsFindingCounts = {
    critical: 0,
    major: 0,
    medium: 0,
    minor: 0,
  };
  let suppressionsApplied = 0;

  for (const finding of params.processedFindings) {
    findingCounts[finding.severity] += 1;
    if (finding.suppressed) suppressionsApplied += 1;
  }

  const reviewDetailsLineCounts = resolveReviewDetailsLineCounts({
    diffLinesAdded: params.diffLinesAdded,
    diffLinesRemoved: params.diffLinesRemoved,
    prApiLinesAdded: params.prApiLinesAdded,
    prApiLinesRemoved: params.prApiLinesRemoved,
  });
  const linesChanged = reviewDetailsLineCounts.linesAdded + reviewDetailsLineCounts.linesRemoved;
  const hasReviewDetailsOperationalSignal =
    params.processedFindings.length > 0
    || params.filteredInlineFindings.length > 0
    || suppressionsApplied > 0
    || params.reviewPlanDetailsSummary.text.includes("doctrine=applied")
    || params.reviewCandidatePublicationRuntime.mode !== "blocked"
    || hasNonDefaultCandidatePublicationReason(params.reviewCandidatePublicationRuntime.reasons);

  return {
    findingCounts,
    suppressionsApplied,
    reviewDetailsLineCounts,
    linesChanged,
    hasReviewDetailsOperationalSignal,
  };
}
