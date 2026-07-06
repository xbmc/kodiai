import type { Logger } from "pino";
import {
  coordinateReviewCandidateApproval,
  type ReviewCandidateApprovalInput,
  type ReviewCandidateApprovalResult,
} from "../review-orchestration/review-candidate-approval.ts";
import {
  adaptApprovedCandidatesForInlinePublication,
  type ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewReducerResult } from "../review-orchestration/review-reducer.ts";

type CoordinateReviewCandidateApproval = (input: ReviewCandidateApprovalInput) => ReviewCandidateApprovalResult;
type AdaptApprovedCandidatesForInlinePublication = typeof adaptApprovedCandidatesForInlinePublication;

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
  const adaptForPublication = params.adaptForPublication ?? adaptApprovedCandidatesForInlinePublication;

  const approval = coordinateApproval({
    candidates: params.candidates,
    reducer: params.reducer,
    fallbackPolicy: {
      allowDirectFallback: directFallbackAllowed,
      attemptedDirectFallback: directPublicationAttempted,
    },
    minConfidence: params.minConfidence,
  });

  const publicationAdapter = adaptForPublication({
    approval,
    reducer: params.reducer,
    prDiffText: params.prDiffText,
    maxFixSuggestions: params.maxFixSuggestions,
    logger: params.logger,
  });

  return {
    directFallbackAllowed,
    directPublicationAttempted,
    approval,
    publicationAdapter,
  };
}
