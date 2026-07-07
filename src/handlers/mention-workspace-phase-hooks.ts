import type { ReviewWorkPhase } from "../jobs/review-work-coordinator.ts";

export type MentionWorkspacePhaseHooks = {
  beforeLoadConfig?: () => void;
};

export function createMentionWorkspacePhaseHooks(params: {
  explicitReviewUsesCanonicalHandle: boolean;
  setReviewWorkPhase: (phase: ReviewWorkPhase) => void;
}): MentionWorkspacePhaseHooks {
  if (!params.explicitReviewUsesCanonicalHandle) {
    return {};
  }

  params.setReviewWorkPhase("workspace-create");
  return {
    beforeLoadConfig: () => params.setReviewWorkPhase("load-config"),
  };
}
