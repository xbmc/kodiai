import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import {
  buildReviewDetailsPhaseTimingSummary,
} from "../review-orchestration/review-phase-timing.ts";
import type { ReviewDetailsBodyBaseParams } from "./review-details-body.ts";

type ReviewDetailsBodyBaseTieredFiles = {
  isLargePR: boolean;
  full: readonly unknown[];
  abbreviated: readonly unknown[];
  mentionOnly: ReadonlyArray<{ filePath: string; score: number }>;
  totalFiles: number;
};

export function buildReviewDetailsBodyBase(params: {
  reviewOutputKey: string;
  filesReviewed: number;
  linesAdded: number;
  linesRemoved: number;
  findingCounts: ReviewDetailsBodyBaseParams["findingCounts"];
  tieredFiles: ReviewDetailsBodyBaseTieredFiles;
  reviewBoundedness: ReviewDetailsBodyBaseParams["reviewBoundedness"];
  feedbackSuppressionCount: number;
  keywordParsing: ReviewDetailsBodyBaseParams["keywordParsing"];
  profileSelection: ReviewDetailsBodyBaseParams["profileSelection"];
  contributorExperience: ReviewDetailsBodyBaseParams["contributorExperience"];
  shadowSpecialistReviewDetails: ReviewDetailsBodyBaseParams["shadowSpecialistReviewDetails"];
  candidatePublicationBridge: ReviewDetailsBodyBaseParams["candidatePublicationBridge"];
  candidateVerificationPublicationEvidence: ReviewDetailsBodyBaseParams["candidateVerificationPublicationEvidence"];
  prioritization: ReviewDetailsBodyBaseParams["prioritization"];
  usageLimit: ReviewDetailsBodyBaseParams["usageLimit"];
  tokenUsage: ReviewDetailsBodyBaseParams["tokenUsage"];
  structuralImpact: ReviewDetailsBodyBaseParams["structuralImpact"];
  reviewPlan: ReviewDetailsBodyBaseParams["reviewPlan"];
  reviewReducer: ReviewDetailsBodyBaseParams["reviewReducer"];
  reviewCandidateFinding: ReviewDetailsBodyBaseParams["reviewCandidateFinding"];
  reviewCandidatePublication: ReviewDetailsBodyBaseParams["reviewCandidatePublication"];
  reviewFindingLifecycle: ReviewDetailsBodyBaseParams["reviewFindingLifecycle"];
  reviewValidationTruth: ReviewDetailsBodyBaseParams["reviewValidationTruth"];
  phaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  publicationPhaseStartedAt: number | undefined;
  totalPhaseStartAt: number;
  lineCountSource: ReviewDetailsBodyBaseParams["lineCountSource"];
}): ReviewDetailsBodyBaseParams {
  return {
    reviewOutputKey: params.reviewOutputKey,
    filesReviewed: params.filesReviewed,
    linesAdded: params.linesAdded,
    linesRemoved: params.linesRemoved,
    findingCounts: params.findingCounts,
    largePRTriage: params.tieredFiles.isLargePR ? {
      fullCount: params.tieredFiles.full.length,
      abbreviatedCount: params.tieredFiles.abbreviated.length,
      mentionOnlyFiles: params.tieredFiles.mentionOnly.map((f) => ({ filePath: f.filePath, score: f.score })),
      totalFiles: params.tieredFiles.totalFiles,
    } : undefined,
    reviewBoundedness: params.reviewBoundedness,
    feedbackSuppressionCount: params.feedbackSuppressionCount,
    keywordParsing: params.keywordParsing,
    profileSelection: params.profileSelection,
    contributorExperience: params.contributorExperience,
    shadowSpecialistReviewDetails: params.shadowSpecialistReviewDetails,
    candidatePublicationBridge: params.candidatePublicationBridge,
    candidateVerificationPublicationEvidence: params.candidateVerificationPublicationEvidence,
    prioritization: params.prioritization,
    usageLimit: params.usageLimit,
    tokenUsage: params.tokenUsage,
    structuralImpact: params.structuralImpact,
    reviewPlan: params.reviewPlan,
    reviewReducer: params.reviewReducer,
    reviewCandidateFinding: params.reviewCandidateFinding,
    reviewCandidatePublication: params.reviewCandidatePublication,
    reviewFindingLifecycle: params.reviewFindingLifecycle,
    reviewValidationTruth: params.reviewValidationTruth,
    phaseTimingSummary: buildReviewDetailsPhaseTimingSummary({
      phases: params.phaseTimings,
      publicationPhaseStartedAt: params.publicationPhaseStartedAt,
      totalPhaseStartAt: params.totalPhaseStartAt,
    }),
    lineCountSource: params.lineCountSource,
  };
}

export function resolveReviewDetailsBodyBase(params: {
  reviewOutputKey: string;
  diffMetrics?: { totalFiles?: number } | null;
  changedFileCount: number;
  reviewDetailsLineCounts: {
    linesAdded: number;
    linesRemoved: number;
    source: ReviewDetailsBodyBaseParams["lineCountSource"];
  };
  findingCounts: ReviewDetailsBodyBaseParams["findingCounts"];
  tieredFiles: ReviewDetailsBodyBaseTieredFiles;
  reviewBoundedness: ReviewDetailsBodyBaseParams["reviewBoundedness"];
  feedbackSuppressionCount: number;
  keywordParsing: ReviewDetailsBodyBaseParams["keywordParsing"];
  profileSelection: ReviewDetailsBodyBaseParams["profileSelection"];
  contributorExperience: ReviewDetailsBodyBaseParams["contributorExperience"];
  shadowSpecialistReviewDetails: ReviewDetailsBodyBaseParams["shadowSpecialistReviewDetails"];
  candidatePublicationBridge: ReviewDetailsBodyBaseParams["candidatePublicationBridge"];
  candidateVerificationPublicationEvidence: ReviewDetailsBodyBaseParams["candidateVerificationPublicationEvidence"];
  prioritization: ReviewDetailsBodyBaseParams["prioritization"];
  usageLimit: ReviewDetailsBodyBaseParams["usageLimit"];
  tokenUsageSource: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
  structuralImpact: ReviewDetailsBodyBaseParams["structuralImpact"];
  reviewPlan: ReviewDetailsBodyBaseParams["reviewPlan"];
  reviewReducer: ReviewDetailsBodyBaseParams["reviewReducer"];
  reviewCandidateFinding: ReviewDetailsBodyBaseParams["reviewCandidateFinding"];
  candidatePublicationDetails: ReviewDetailsBodyBaseParams["reviewCandidatePublication"];
  reviewFindingLifecycle: ReviewDetailsBodyBaseParams["reviewFindingLifecycle"];
  reviewValidationTruth: ReviewDetailsBodyBaseParams["reviewValidationTruth"];
  phaseTimings: Map<ReviewPhaseName, ReviewPhaseTiming>;
  publicationPhaseStartedAt: number | undefined;
  totalPhaseStartAt: number;
}): ReviewDetailsBodyBaseParams {
  return buildReviewDetailsBodyBase({
    reviewOutputKey: params.reviewOutputKey,
    filesReviewed: params.diffMetrics?.totalFiles ?? params.changedFileCount,
    linesAdded: params.reviewDetailsLineCounts.linesAdded,
    linesRemoved: params.reviewDetailsLineCounts.linesRemoved,
    findingCounts: params.findingCounts,
    tieredFiles: params.tieredFiles,
    reviewBoundedness: params.reviewBoundedness,
    feedbackSuppressionCount: params.feedbackSuppressionCount,
    keywordParsing: params.keywordParsing,
    profileSelection: params.profileSelection,
    contributorExperience: params.contributorExperience,
    shadowSpecialistReviewDetails: params.shadowSpecialistReviewDetails,
    candidatePublicationBridge: params.candidatePublicationBridge,
    candidateVerificationPublicationEvidence: params.candidateVerificationPublicationEvidence,
    prioritization: params.prioritization,
    usageLimit: params.usageLimit,
    tokenUsage: {
      inputTokens: params.tokenUsageSource.inputTokens,
      outputTokens: params.tokenUsageSource.outputTokens,
      costUsd: params.tokenUsageSource.costUsd,
    },
    structuralImpact: params.structuralImpact,
    reviewPlan: params.reviewPlan,
    reviewReducer: params.reviewReducer,
    reviewCandidateFinding: params.reviewCandidateFinding,
    reviewCandidatePublication: params.candidatePublicationDetails,
    reviewFindingLifecycle: params.reviewFindingLifecycle,
    reviewValidationTruth: params.reviewValidationTruth,
    phaseTimings: params.phaseTimings,
    publicationPhaseStartedAt: params.publicationPhaseStartedAt,
    totalPhaseStartAt: params.totalPhaseStartAt,
    lineCountSource: params.reviewDetailsLineCounts.source,
  });
}
