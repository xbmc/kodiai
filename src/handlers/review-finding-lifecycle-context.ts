import type { Logger } from "pino";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import {
  attachReviewFindingLifecycle,
  type AttachReviewFindingLifecycleResult,
  type AttachReviewValidationTruthResult,
} from "../review-lifecycle/handler-lifecycle.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewCandidatePublicationAdapterResult } from "../review-orchestration/review-candidate-publication-adapter.ts";
import type { ProcessedReviewFinding } from "../review-orchestration/review-reducer.ts";
import { projectAutomaticReviewValidationTruth } from "./review-validation-truth.ts";

export type ReviewFindingLifecycleContext = {
  lifecycleResult: AttachReviewFindingLifecycleResult;
  validationTruthProjection: AttachReviewValidationTruthResult["projection"] | null;
};

export function resolveReviewFindingLifecycleContext(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  owner: string;
  repo: string;
  prNumber: number;
  reviewOutputKey: string;
  deliveryId: string;
  headSha?: string | null;
  baseSha?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
  findings: ReadonlyArray<ProcessedReviewFinding>;
  candidateFinding?: ReviewCandidateFindingExecutionResult | null;
  candidatePublicationPayloads: ReviewCandidatePublicationAdapterResult["payloads"];
  candidatePublisherResults: ReadonlyMap<string, InlineReviewPublicationResult>;
}): ReviewFindingLifecycleContext {
  const lifecycleResult = attachReviewFindingLifecycle({
    source: "automatic",
    trigger: "pull_request",
    correlation: {
      repo: `${params.owner}/${params.repo}`,
      pullNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
      deliveryId: params.deliveryId,
      commitSha: params.headSha,
      headSha: params.headSha,
      baseSha: params.baseSha,
      headRef: params.headRef,
      baseRef: params.baseRef,
    },
    findings: params.findings,
    candidateFinding: params.candidateFinding,
  });
  params.logger.info(
    {
      ...params.baseLog,
      ...lifecycleResult.logEvidence,
      source: "automatic-review",
    },
    "Projected review finding lifecycle evidence",
  );

  const validationTruthResult = projectAutomaticReviewValidationTruth({
    logger: params.logger,
    baseLog: params.baseLog,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    reviewOutputKey: params.reviewOutputKey,
    deliveryId: params.deliveryId,
    headSha: params.headSha,
    baseSha: params.baseSha,
    headRef: params.headRef,
    baseRef: params.baseRef,
    lifecycleResult,
    candidatePublicationPayloads: params.candidatePublicationPayloads,
    candidatePublisherResults: params.candidatePublisherResults,
  });

  return {
    lifecycleResult,
    validationTruthProjection: validationTruthResult.ok ? validationTruthResult.value : null,
  };
}
