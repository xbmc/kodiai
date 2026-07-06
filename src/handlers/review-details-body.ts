import {
  formatReviewDetailsSummary,
  type ReviewDetailsSummaryParams,
  type TimeoutBudgetDetails,
  type TimeoutReviewDetailsProgress,
} from "../lib/review-details-formatting.ts";
import { formatSuppressedFindingsSection } from "../lib/output-filter.ts";
import type { FilteredFindingRecord } from "../lib/output-filter.ts";
import { appendReviewDetailsBudgetLines } from "../review-orchestration/review-visible-budget-evidence.ts";
import type { VisibleBudgetProjection } from "../review-visible-budget/visible-budget-behavior.ts";
import type { ReviewFirstPassPayload } from "../lib/review-first-pass.ts";

export type ReviewDetailsBodyBaseParams = Omit<
  ReviewDetailsSummaryParams,
  "includeOperationalDiagnostics" | "reviewFirstPass" | "timeoutProgress" | "timeoutBudget"
>;

export type ReviewDetailsBodyRuntimeParams = {
  timeoutProgress?: TimeoutReviewDetailsProgress;
  reviewFirstPass?: ReviewFirstPassPayload | null;
  timeoutBudget?: TimeoutBudgetDetails | null;
};

export function buildReviewDetailsBody(params: {
  base: ReviewDetailsBodyBaseParams;
  hasOperationalSignal: boolean;
  visibleBudgetProjection: VisibleBudgetProjection | null;
  filteredFindings: FilteredFindingRecord[];
  runtime?: ReviewDetailsBodyRuntimeParams;
}): string {
  const runtime = params.runtime;
  const reviewDetailsBody = appendReviewDetailsBudgetLines(formatReviewDetailsSummary({
    ...params.base,
    includeOperationalDiagnostics:
      params.hasOperationalSignal
      || Boolean(runtime?.timeoutProgress)
      || Boolean(runtime?.reviewFirstPass),
    reviewFirstPass: runtime?.reviewFirstPass,
    timeoutProgress: runtime?.timeoutProgress,
    timeoutBudget: runtime?.timeoutBudget,
  }), params.visibleBudgetProjection);

  const suppressedSection = formatSuppressedFindingsSection(params.filteredFindings);
  return suppressedSection
    ? `${reviewDetailsBody}\n\n${suppressedSection}`
    : reviewDetailsBody;
}
