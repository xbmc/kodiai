import type {
  ProcessedReviewFinding,
  ReviewReducerResult,
} from "../review-orchestration/review-reducer.ts";
import type { ReviewCandidatePublishedFindingResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { ReviewCandidatePublicationAdapterDetailsSummary } from "../review-orchestration/review-candidate-publication-adapter.ts";
import {
  isCandidatePublicationDraft,
  mergeCandidatePublishedFindings,
} from "../review-orchestration/review-candidate-finding-merge.ts";
import type { ProcessedFinding } from "./review-processed-finding.ts";

export type ReviewFindingPublicationContext = {
  processedFindings: ProcessedFinding[];
  visibleFindings: ProcessedFinding[];
  lowConfidenceFindings: ProcessedFinding[];
  filteredInlineFindings: ProcessedFinding[];
  suppressionMatchCounts: ReviewReducerResult["suppressionMatchCounts"];
  filterResult: { filtered: ReviewReducerResult["filterRecords"] };
  prioritizationStats: ReviewReducerResult["prioritizationStats"];
  reviewReducerDetailsSummary: ReviewReducerResult["detailsSummary"];
  reviewCandidatePublicationAdapterDetailsSummary: ReviewCandidatePublicationAdapterDetailsSummary;
};

export function resolveReviewFindingPublicationContext(params: {
  reducer: ReviewReducerResult;
  candidatePublishedFindings: ReviewCandidatePublishedFindingResult;
  adapterDetailsSummary: ReviewCandidatePublicationAdapterDetailsSummary;
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
    ) as ProcessedFinding[],
    visibleFindings: mergeCandidatePublishedFindings(
      directVisibleFindings,
      params.candidatePublishedFindings.findings,
    ) as ProcessedFinding[],
    lowConfidenceFindings: directLowConfidenceFindings as ProcessedFinding[],
    filteredInlineFindings: directFilteredInlineFindings as ProcessedFinding[],
    suppressionMatchCounts: params.reducer.suppressionMatchCounts,
    filterResult: { filtered: params.reducer.filterRecords },
    prioritizationStats: params.reducer.prioritizationStats,
    reviewReducerDetailsSummary: params.reducer.detailsSummary,
    reviewCandidatePublicationAdapterDetailsSummary: params.adapterDetailsSummary,
  };
}
