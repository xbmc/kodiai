import type { Logger } from "pino";
import {
  coordinateReviewCandidateApproval,
  type ReviewCandidateApprovalInput,
  type ReviewCandidateApprovalResult,
} from "../review-orchestration/review-candidate-approval.ts";
import {
  adaptApprovedCandidatesForInlinePublicationResult,
  type ReviewCandidatePublicationAdapterOutcome,
  type ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewReducerResult } from "../review-orchestration/review-reducer.ts";

type CoordinateReviewCandidateApproval = (input: ReviewCandidateApprovalInput) => ReviewCandidateApprovalResult;
type AdaptApprovedCandidatesForInlinePublication = (input: Parameters<typeof adaptApprovedCandidatesForInlinePublicationResult>[0]) =>
  ReviewCandidatePublicationAdapterOutcome;

export type ReviewCandidateApprovalContext = {
  directFallbackAllowed: boolean;
  directPublicationAttempted: boolean;
  approval: ReviewCandidateApprovalResult;
  publicationAdapter: ReviewCandidatePublicationAdapterResult;
};

export function resolveReviewCandidateApprovalContext(params: {
  candidates: ReviewCandidateFindingExecutionResult;
  reducer: ReviewReducerResult;
  resultPublished: boolean;
  extractedFindingCount: number;
  minConfidence: number;
  prDiffText?: string | null;
  maxFixSuggestions?: number;
  logger: Logger;
  coordinateApproval?: CoordinateReviewCandidateApproval;
  adaptForPublication?: AdaptApprovedCandidatesForInlinePublication;
}): ReviewCandidateApprovalContext {
  const directFallbackAllowed = params.candidates.status !== "shadow"
    || params.candidates.counts.recorded === 0;
  const directPublicationAttempted = params.resultPublished === true || params.extractedFindingCount > 0;
  const coordinateApproval = params.coordinateApproval ?? coordinateReviewCandidateApproval;
  const adaptForPublication = params.adaptForPublication ?? adaptApprovedCandidatesForInlinePublicationResult;

  const approval = coordinateApproval({
    candidates: params.candidates,
    reducer: params.reducer,
    fallbackPolicy: {
      allowDirectFallback: directFallbackAllowed,
      attemptedDirectFallback: directPublicationAttempted,
    },
    minConfidence: params.minConfidence,
  });

  const publicationAdapterResult = adaptForPublication({
    approval,
    reducer: params.reducer,
    prDiffText: params.prDiffText,
    maxFixSuggestions: params.maxFixSuggestions,
    logger: params.logger,
  });
  if (!publicationAdapterResult.ok) {
    throw publicationAdapterResult.err;
  }
  const publicationAdapter = publicationAdapterResult.value;

  return {
    directFallbackAllowed,
    directPublicationAttempted,
    approval,
    publicationAdapter,
  };
}
