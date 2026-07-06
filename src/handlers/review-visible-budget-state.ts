import type { ContinuationCompactionObservation } from "../review-continuation/continuation-compaction.ts";
import type { ReviewCacheTelemetryObservation } from "../review-cache-telemetry/cache-telemetry.ts";
import {
  buildVisibleBudgetProjectionFromEvidence,
} from "../review-orchestration/review-visible-budget-evidence.ts";
import type { VisibleBudgetProjection } from "../review-visible-budget/visible-budget-behavior.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";

export type ReviewVisibleBudgetProjectionState = {
  readonly reviewCacheObservations: ReviewCacheTelemetryObservation[];
  readonly continuationCompactionObservations: ContinuationCompactionObservation[];
  promptSectionRecords: PromptSectionRecord[];
  projection: VisibleBudgetProjection | null;
  refresh(): VisibleBudgetProjection | null;
};

export function createReviewVisibleBudgetProjectionState(): ReviewVisibleBudgetProjectionState {
  return {
    reviewCacheObservations: [],
    continuationCompactionObservations: [],
    promptSectionRecords: [],
    projection: null,
    refresh() {
      this.projection = buildVisibleBudgetProjectionFromEvidence({
        promptSectionRecords: this.promptSectionRecords,
        cacheTelemetryObservations: this.reviewCacheObservations,
        continuationCompactionObservations: this.continuationCompactionObservations,
      });
      return this.projection;
    },
  };
}
