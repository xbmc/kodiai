import type { Logger } from "pino";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import {
  attachReviewValidationTruth,
  type AttachReviewFindingLifecycleResult,
  type AttachReviewValidationTruthInput,
  type AttachReviewValidationTruthResult,
} from "../review-lifecycle/handler-lifecycle.ts";

export type ExplicitMentionReviewValidationTruthProjectionResult =
  Result<AttachReviewValidationTruthResult["projection"]>;

type ExplicitMentionReviewValidationTruthLogger = Pick<Logger, "info" | "warn">;

export type ProjectExplicitMentionReviewValidationTruthParams = {
  logger: ExplicitMentionReviewValidationTruthLogger;
  surface: string;
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
  attachValidationTruth?: (input: AttachReviewValidationTruthInput) => AttachReviewValidationTruthResult;
};

export function projectExplicitMentionReviewValidationTruth(
  params: ProjectExplicitMentionReviewValidationTruthParams,
): ExplicitMentionReviewValidationTruthProjectionResult {
  try {
    const explicitReviewValidationTruth = (params.attachValidationTruth ?? attachReviewValidationTruth)({
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
      publicationFixes: [],
      requireRevalidation: true,
    });
    params.logger.info(
      {
        surface: params.surface,
        owner: params.owner,
        repo: params.repo,
        prNumber: params.prNumber,
        ...explicitReviewValidationTruth.logEvidence,
        gateResult: explicitReviewValidationTruth.status,
        source: "explicit-mention-review",
      },
      "Projected explicit mention review validation truth evidence",
    );
    return resultOk(explicitReviewValidationTruth.projection);
  } catch (err) {
    const error = toError(err);
    try {
      params.logger.warn(
        {
          err: error,
          surface: params.surface,
          owner: params.owner,
          repo: params.repo,
          prNumber: params.prNumber,
          gate: "review-validation-truth",
          gateResult: "degraded",
          reviewOutputKey: params.reviewOutputKey,
          deliveryId: params.deliveryId,
        },
        "Explicit mention review validation truth diagnostics failed; continuing review publication",
      );
    } catch {
      // Diagnostics are fail-open for review execution and must not block publication.
    }
    return resultErr(error);
  }
}
