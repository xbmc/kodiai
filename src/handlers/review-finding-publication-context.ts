import type {
  ProcessedReviewFinding,
  ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import type { ReviewCandidatePublishedFindingResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import {
  isCandidatePublicationDraft,
  mergeCandidatePublishedFindings,
} from "../review-orchestration/review-candidate-finding-merge.ts";

export type ReviewFindingPublicationContext = {
  processedFindings: ProcessedReviewFinding[];
  visibleFindings: ProcessedReviewFinding[];
  lowConfidenceFindings: ProcessedReviewFinding[];
  filteredInlineFindings: ProcessedReviewFinding[];
  suppressionMatchCounts: ReviewReducerResult["suppressionMatchCounts"];
  filterResult: { filtered: ReviewReducerResult["filterRecords"] };
  prioritizationStats: ReviewReducerResult["prioritizationStats"];
  reviewReducerDetailsSummary: ReviewReducerResult["detailsSummary"];
};

export function resolveReviewFindingPublicationContext(params: {
  reducer: ReviewReducerResult;
  candidatePublishedFindings: ReviewCandidatePublishedFindingResult;
}): ReviewFindingPublicationContext {
  const directProcessedFindings = params.reducer.findings
    .filter((finding) => !isCandidatePublicationDraft(finding));
  const directVisibleFindings = params.reducer.visibleFindings
    .filter((finding) => !isCandidatePublicationDraft(finding));
  const directLowConfidenceFindings = params.reducer.lowConfidenceFindings
    .filter((finding) => !isCandidatePublicationDraft(finding));
  const directFilteredInlineFindings = params.reducer.filteredInlineFindings
    .filter((finding) => !isCandidatePublicationDraft(finding));

  return {
    processedFindings: mergeCandidatePublishedFindings(
      directProcessedFindings,
      params.candidatePublishedFindings.findings,
    ),
    visibleFindings: mergeCandidatePublishedFindings(
      directVisibleFindings,
      params.candidatePublishedFindings.findings,
    ),
    lowConfidenceFindings: directLowConfidenceFindings,
    filteredInlineFindings: directFilteredInlineFindings,
    suppressionMatchCounts: params.reducer.suppressionMatchCounts,
    filterResult: { filtered: params.reducer.filterRecords },
    prioritizationStats: params.reducer.prioritizationStats,
    reviewReducerDetailsSummary: params.reducer.detailsSummary,
  };
}
