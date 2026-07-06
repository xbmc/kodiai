import type { Logger } from "pino";
import type { InlineReviewPublicationResult } from "../execution/mcp/inline-review-publisher.ts";
import {
  attachReviewValidationTruth,
  type AttachReviewFindingLifecycleResult,
  type AttachReviewValidationTruthInput,
  type AttachReviewValidationTruthResult,
} from "../review-lifecycle/handler-lifecycle.ts";
import {
  convertPublishedCandidateResultsToValidationTruthFixes,
  type ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";

export type AutomaticReviewValidationTruthProjectionResult =
  | { status: "recorded"; projection: AttachReviewValidationTruthResult["projection"] }
  | { status: "failed"; projection: null };

type AutomaticReviewValidationTruthLogger = Pick<Logger, "info" | "warn">;

export type ProjectAutomaticReviewValidationTruthParams = {
  logger: AutomaticReviewValidationTruthLogger;
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
  lifecycleResult: AttachReviewFindingLifecycleResult;
  candidatePublicationPayloads: ReviewCandidatePublicationAdapterResult["payloads"];
  candidatePublisherResults: ReadonlyMap<string, InlineReviewPublicationResult>;
  attachValidationTruth?: (input: AttachReviewValidationTruthInput) => AttachReviewValidationTruthResult;
};

export function projectAutomaticReviewValidationTruth(
  params: ProjectAutomaticReviewValidationTruthParams,
): AutomaticReviewValidationTruthProjectionResult {
  try {
    const reviewValidationTruth = (params.attachValidationTruth ?? attachReviewValidationTruth)({
      lifecycle: params.lifecycleResult.lifecycle,
      correlation: {
        repo: `${params.owner}/${params.repo}`,
        pullNumber: params.prNumber,
        reviewOutputKey: params.reviewOutputKey,
        deliveryId: params.deliveryId,
        commitSha: params.headSha ?? params.headRef,
        headSha: params.headSha,
        baseSha: params.baseSha,
        headRef: params.headRef,
        baseRef: params.baseRef,
      },
      publicationFixes: convertPublishedCandidateResultsToValidationTruthFixes({
        payloads: params.candidatePublicationPayloads,
        results: params.candidatePublisherResults,
        reviewOutputKey: params.reviewOutputKey,
        deliveryId: params.deliveryId,
      }),
      requireRevalidation: true,
    });
    params.logger.info(
      {
        ...params.baseLog,
        ...reviewValidationTruth.logEvidence,
        gateResult: reviewValidationTruth.status,
        source: "automatic-review",
      },
      "Projected review validation truth evidence",
    );
    return { status: "recorded", projection: reviewValidationTruth.projection };
  } catch (err) {
    try {
      params.logger.warn(
        {
          ...params.baseLog,
          err,
          gate: "review-validation-truth",
          gateResult: "degraded",
          reviewOutputKey: params.reviewOutputKey,
          deliveryId: params.deliveryId,
        },
        "Review validation truth diagnostics failed; continuing review publication",
      );
    } catch {
      // Diagnostics are fail-open for review execution and must not block publication.
    }
    return { status: "failed", projection: null };
  }
}
