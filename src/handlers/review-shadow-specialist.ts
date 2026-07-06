import type { Logger } from "pino";
import type { CandidateVerificationContext } from "../execution/mcp/review-output-publication-gate.ts";
import {
  buildShadowSpecialistCorrelationKey,
  buildShadowSpecialistLogFields,
} from "../review-orchestration/review-specialist-publication-log.ts";
import { projectShadowSpecialistMetrics } from "../specialists/shadow-specialist-metrics.ts";
import {
  buildShadowSpecialistReviewDetailsProjection,
  type ShadowSpecialistReviewDetailsProjection,
} from "../specialists/shadow-specialist-review-details.ts";
import type {
  ShadowSpecialistSubflowInput,
  ShadowSpecialistSubflowResult,
} from "../specialists/shadow-specialist-subflow.ts";
import { buildShadowSpecialistDiffSnippet } from "./review-handler-utils.ts";

type ReviewShadowSpecialistLogger = Pick<Logger, "info" | "warn">;

export type ReviewShadowSpecialistContext = {
  readonly shadowSpecialistResult: ShadowSpecialistSubflowResult | undefined;
  readonly shadowSpecialistReviewDetailsProjection: ShadowSpecialistReviewDetailsProjection | null;
  readonly candidateVerificationContext: CandidateVerificationContext;
};

export async function resolveReviewShadowSpecialistContext(params: {
  changedFiles: readonly string[];
  diffContentForValidation: string;
  workspaceDir: string;
  deliveryId: string;
  reviewOutputKey: string;
  prNumber: number;
  baseLog: Record<string, unknown>;
  logger: ReviewShadowSpecialistLogger;
  shadowSpecialistSubflow: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
}): Promise<ReviewShadowSpecialistContext> {
  const shadowSpecialistCorrelationKey = buildShadowSpecialistCorrelationKey({
    deliveryId: params.deliveryId,
    reviewOutputKey: params.reviewOutputKey,
    prNumber: params.prNumber,
  });

  try {
    const shadowSpecialistResult = await params.shadowSpecialistSubflow({
      changedPaths: params.changedFiles,
      diffText: params.diffContentForValidation,
      diffSnippet: buildShadowSpecialistDiffSnippet(params.diffContentForValidation),
      workspaceDir: params.workspaceDir,
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      correlationKey: shadowSpecialistCorrelationKey,
    });

    const candidateVerificationContext = {
      docsConfigTruth: shadowSpecialistResult.output,
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      correlationKey: shadowSpecialistResult.correlationKey ?? shadowSpecialistCorrelationKey,
    };
    const shadowSpecialistReviewDetailsProjection = buildShadowSpecialistReviewDetailsProjection(
      projectShadowSpecialistMetrics(shadowSpecialistResult),
    );

    const shadowLogFields = {
      ...params.baseLog,
      ...buildShadowSpecialistLogFields(shadowSpecialistResult),
    };
    const shadowMessage = "Shadow specialist subflow completed";
    if (shadowSpecialistResult.timeoutReason || shadowSpecialistResult.errorReason || shadowSpecialistResult.unclassifiableReason) {
      params.logger.warn(shadowLogFields, shadowMessage);
    } else {
      params.logger.info(shadowLogFields, shadowMessage);
    }

    return {
      shadowSpecialistResult,
      shadowSpecialistReviewDetailsProjection,
      candidateVerificationContext,
    };
  } catch (err) {
    const candidateVerificationContext = {
      docsConfigTruth: null,
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      correlationKey: shadowSpecialistCorrelationKey,
    };

    params.logger.warn(
      {
        ...params.baseLog,
        gate: "shadow-specialist",
        laneId: "docs-config-truth",
        status: "error",
        reason: "handler-subflow-error",
        deliveryId: params.deliveryId,
        reviewOutputKey: params.reviewOutputKey,
        correlationKey: shadowSpecialistCorrelationKey,
        err,
      },
      "Shadow specialist subflow failed before normal review; continuing fail-open",
    );

    return {
      shadowSpecialistResult: undefined,
      shadowSpecialistReviewDetailsProjection: null,
      candidateVerificationContext,
    };
  }
}
