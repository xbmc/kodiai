import type { Logger } from "pino";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import type { ReviewCandidateApprovalResult } from "../review-orchestration/review-candidate-approval.ts";
import type {
  ReviewCandidatePublishedFindingResult,
  ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import type {
  CandidatePublicationFlowEvidence,
  ReviewCandidatePublicationRuntimeResult,
} from "../review-orchestration/review-candidate-publication-runtime.ts";
import type { ReviewReducerResult } from "../review-orchestration/review-reducer.ts";
import {
  resolveReviewCandidatePublicationRuntimeContext,
} from "./review-candidate-publication-runtime-context.ts";
import {
  resolveReviewFindingPublicationContext,
  type ReviewFindingPublicationContext,
} from "./review-finding-publication-context.ts";

export type ReviewPublicationContext = ReviewFindingPublicationContext & {
  reviewCandidatePublishedFindings: ReviewCandidatePublishedFindingResult;
  reviewCandidatePublicationRuntime: ReviewCandidatePublicationRuntimeResult;
  reviewCandidatePublicationFlow: CandidatePublicationFlowEvidence;
};

export function resolveReviewPublicationContext(params: {
  approval: ReviewCandidateApprovalResult;
  adapter: ReviewCandidatePublicationAdapterResult;
  publisherResults: ReadonlyMap<string, InlineReviewPublicationResult>;
  directPublication: {
    attempted: boolean;
    allowed: boolean;
    publishedFindingCount: number;
    resultPublished: boolean;
  };
  reducer: ReviewReducerResult;
  logger: Logger;
  baseLog: Record<string, unknown>;
}): ReviewPublicationContext {
  const candidatePublicationContext = resolveReviewCandidatePublicationRuntimeContext({
    approval: params.approval,
    adapter: params.adapter,
    publisherResults: params.publisherResults,
    directPublication: params.directPublication,
    logger: params.logger,
    baseLog: params.baseLog,
  });
  const findingPublicationContext = resolveReviewFindingPublicationContext({
    reducer: params.reducer,
    candidatePublishedFindings: candidatePublicationContext.publishedFindings,
    adapterDetailsSummary: candidatePublicationContext.adapterDetailsSummary,
  });

  return {
    ...findingPublicationContext,
    reviewCandidatePublishedFindings: candidatePublicationContext.publishedFindings,
    reviewCandidatePublicationRuntime: candidatePublicationContext.runtime,
    reviewCandidatePublicationFlow: candidatePublicationContext.flow,
  };
}
