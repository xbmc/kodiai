import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ReviewBoundednessContract } from "./review-boundedness.ts";

export type ReviewFirstPassBoundedReason = "timeout" | "max-turns" | "large-pr";
export type ReviewFirstPassEvidenceSource = "checkpoint" | "boundedness" | "none";
export type ReviewFirstPassScope = {
  reviewedFiles: number;
  totalFiles: number;
};

export type ReviewFirstPassRemainingScope = {
  remainingFiles: number;
  totalFiles: number;
};

export type ReviewFirstPassPublicationState = {
  eligible: boolean;
  hasPublishedOutput: boolean;
};

export type ReviewFirstPassPayload = {
  state: "bounded-first-pass" | "zero-evidence-failure";
  boundedReason: ReviewFirstPassBoundedReason;
  evidenceSource: ReviewFirstPassEvidenceSource;
  coveredScope?: ReviewFirstPassScope;
  remainingScope?: ReviewFirstPassRemainingScope;
  findingCount?: number;
  publication: ReviewFirstPassPublicationState;
  continuationPending: boolean;
  zeroEvidenceFailure: boolean;
};

export type ReviewFirstPassOutcome = {
  conclusion: string | null | undefined;
  stopReason?: string | null | undefined;
  failureSubtype?: string | null | undefined;
  isTimeout?: boolean | null | undefined;
  published?: boolean | null | undefined;
};

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function resolveBoundedReason(params: {
  boundedness: ReviewBoundednessContract | null | undefined;
  outcome: ReviewFirstPassOutcome | null | undefined;
}): ReviewFirstPassBoundedReason | null {
  const { boundedness, outcome } = params;

  if (outcome?.isTimeout === true) {
    return "timeout";
  }

  if (outcome?.stopReason === "max_turns" || outcome?.failureSubtype === "error_max_turns") {
    return "max-turns";
  }

  if (boundedness?.largePR) {
    return "large-pr";
  }

  return null;
}

function resolveEvidenceSource(params: {
  boundedness: ReviewBoundednessContract | null | undefined;
  checkpoint: CheckpointRecord | null | undefined;
}): ReviewFirstPassEvidenceSource {
  const { boundedness, checkpoint } = params;

  if (checkpoint) {
    return "checkpoint";
  }

  if (boundedness?.largePR) {
    return "boundedness";
  }

  return "none";
}

function normalizeCheckpointScope(checkpoint: CheckpointRecord | null | undefined): {
  coveredScope?: ReviewFirstPassScope;
  remainingScope?: ReviewFirstPassRemainingScope;
} {
  if (!checkpoint) {
    return {};
  }

  const reviewedFiles = checkpoint.filesReviewed.length;
  const totalFiles = checkpoint.totalFiles;

  if (
    !Array.isArray(checkpoint.filesReviewed) ||
    !isFiniteNonNegativeNumber(totalFiles) ||
    reviewedFiles > totalFiles
  ) {
    return {};
  }

  return {
    coveredScope: {
      reviewedFiles,
      totalFiles,
    },
    remainingScope: {
      remainingFiles: totalFiles - reviewedFiles,
      totalFiles,
    },
  };
}

function normalizeBoundednessScope(boundedness: ReviewBoundednessContract | null | undefined): {
  coveredScope?: ReviewFirstPassScope;
  remainingScope?: ReviewFirstPassRemainingScope;
} {
  const largePR = boundedness?.largePR;
  if (!largePR) {
    return {};
  }

  if (
    !isFiniteNonNegativeNumber(largePR.reviewedCount) ||
    !isFiniteNonNegativeNumber(largePR.totalFiles) ||
    !isFiniteNonNegativeNumber(largePR.notReviewedCount) ||
    largePR.reviewedCount > largePR.totalFiles ||
    largePR.reviewedCount + largePR.notReviewedCount !== largePR.totalFiles
  ) {
    return {};
  }

  return {
    coveredScope: {
      reviewedFiles: largePR.reviewedCount,
      totalFiles: largePR.totalFiles,
    },
    remainingScope: {
      remainingFiles: largePR.notReviewedCount,
      totalFiles: largePR.totalFiles,
    },
  };
}

function resolveScope(params: {
  checkpoint: CheckpointRecord | null | undefined;
  boundedness: ReviewBoundednessContract | null | undefined;
}): {
  coveredScope?: ReviewFirstPassScope;
  remainingScope?: ReviewFirstPassRemainingScope;
} {
  const checkpointScope = normalizeCheckpointScope(params.checkpoint);
  if (checkpointScope.coveredScope || checkpointScope.remainingScope) {
    return checkpointScope;
  }

  return normalizeBoundednessScope(params.boundedness);
}

function resolveFindingCount(checkpoint: CheckpointRecord | null | undefined): number | undefined {
  if (!checkpoint) {
    return undefined;
  }

  return isFiniteNonNegativeNumber(checkpoint.findingCount) ? checkpoint.findingCount : undefined;
}

export function normalizeReviewFirstPass(params: {
  boundedness: ReviewBoundednessContract | null | undefined;
  checkpoint: CheckpointRecord | null | undefined;
  outcome: ReviewFirstPassOutcome | null | undefined;
}): ReviewFirstPassPayload | null {
  const boundedReason = resolveBoundedReason({
    boundedness: params.boundedness,
    outcome: params.outcome,
  });

  if (!boundedReason) {
    return null;
  }

  const evidenceSource = resolveEvidenceSource({
    boundedness: params.boundedness,
    checkpoint: params.checkpoint,
  });
  const publication = {
    eligible: evidenceSource !== "none",
    hasPublishedOutput: params.outcome?.published === true,
  } satisfies ReviewFirstPassPublicationState;

  if (evidenceSource === "none") {
    return {
      state: "zero-evidence-failure",
      boundedReason,
      evidenceSource,
      publication,
      continuationPending: false,
      zeroEvidenceFailure: true,
    };
  }

  const scope = resolveScope({
    checkpoint: params.checkpoint,
    boundedness: params.boundedness,
  });

  return {
    state: "bounded-first-pass",
    boundedReason,
    evidenceSource,
    coveredScope: scope.coveredScope,
    remainingScope: scope.remainingScope,
    findingCount: resolveFindingCount(params.checkpoint),
    publication,
    continuationPending: true,
    zeroEvidenceFailure: false,
  };
}
