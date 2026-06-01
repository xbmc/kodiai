import type { ReviewPlanDetailsSummary } from "../review-orchestration/review-plan.ts";
import type { ReviewReducerDetailsSummary } from "../review-orchestration/review-reducer.ts";

export function formatReviewPlanDetailsLine(reviewPlan?: ReviewPlanDetailsSummary | null): string[] {
  try {
    const text = typeof reviewPlan?.text === "string"
      ? reviewPlan.text.trim().replace(/\s+/g, " ")
      : "";
    return text ? [`- ${text}`] : [];
  } catch {
    return [];
  }
}

export function formatReviewReducerDetailsLine(reviewReducer?: ReviewReducerDetailsSummary | null): string[] {
  try {
    const text = typeof reviewReducer?.text === "string"
      ? reviewReducer.text.trim().replace(/\s+/g, " ")
      : "";
    return text ? [`- ${text}`] : [];
  } catch {
    return [];
  }
}
