import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";

export type ReviewWorkspacePhaseHooks = {
  workspacePhaseStartedAt: number;
  onBeforeFinalizeConfig: () => void;
};

export function createReviewWorkspacePhaseHooks(params: {
  now?: () => number;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
}): ReviewWorkspacePhaseHooks {
  params.setReviewWorkPhase("workspace-create");

  return {
    workspacePhaseStartedAt: params.now?.() ?? Date.now(),
    onBeforeFinalizeConfig: () => params.setReviewWorkPhase("load-config"),
  };
}
