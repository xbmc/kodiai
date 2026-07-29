import type { Logger } from "pino";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import type { ReviewCandidateApprovalResult } from "../review-orchestration/review-candidate-approval.ts";
import {
  convertPublishedCandidateResultsToProcessedFindings,
  toReviewCandidatePublicationAdapterSummary,
  type ReviewCandidatePublishedFindingResult,
  type ReviewCandidatePublicationAdapterDetailsSummary,
  type ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";
import {
  classifyReviewCandidatePublicationRuntime,
  createCandidatePublicationFlowEvidence,
  type CandidatePublicationFlowEvidence,
  type ReviewCandidatePublicationRuntimeResult,
} from "../review-orchestration/review-candidate-publication-runtime.ts";
import { logReviewCandidatePublicationRuntime } from "../review-orchestration/review-candidate-publication-log.ts";

export type ReviewCandidatePublicationRuntimeContext = {
  publishedFindings: ReviewCandidatePublishedFindingResult;
  runtime: ReviewCandidatePublicationRuntimeResult;
  flow: CandidatePublicationFlowEvidence;
  adapterDetailsSummary: ReviewCandidatePublicationAdapterDetailsSummary;
};

export function resolveReviewCandidatePublicationRuntimeContext(params: {
  approval: ReviewCandidateApprovalResult;
  adapter: ReviewCandidatePublicationAdapterResult;
  publisherResults: ReadonlyMap<string, InlineReviewPublicationResult>;
  directPublication: {
    attempted: boolean;
    allowed: boolean;
    publishedFindingCount: number;
    resultPublished: boolean;
  };
  logger: Logger;
  baseLog: Record<string, unknown>;
}): ReviewCandidatePublicationRuntimeContext {
  const publishedFindings = convertPublishedCandidateResultsToProcessedFindings({
    payloads: params.adapter.payloads,
    results: params.publisherResults,
  });
  const runtime = classifyReviewCandidatePublicationRuntime({
    approval: params.approval,
    adapter: params.adapter.summary,
    publisher: publishedFindings.summary,
    publisherDetailsOnlyFindings: publishedFindings.detailsOnlyFindings,
    convertedProcessedFindingCount: publishedFindings.findings.length,
    directPublication: {
      attempted: params.directPublication.attempted,
      allowed: params.directPublication.allowed,
      published: params.directPublication.attempted
        ? Math.max(params.directPublication.publishedFindingCount, params.directPublication.resultPublished ? 1 : 0)
        : 0,
      reason: params.directPublication.allowed ? "direct-fallback-audited" : "direct-fallback-disallowed",
    },
  });
  const flow = createCandidatePublicationFlowEvidence({
    payloadFingerprints: params.adapter.payloads.map((payload) => payload.candidateFingerprint),
    publisher: publishedFindings.summary,
  });
  logReviewCandidatePublicationRuntime({
    logger: params.logger,
    baseLog: params.baseLog,
    runtime,
  });

  return {
    publishedFindings,
    runtime,
    flow,
    adapterDetailsSummary: toReviewCandidatePublicationAdapterSummary(params.adapter.summary),
  };
}
