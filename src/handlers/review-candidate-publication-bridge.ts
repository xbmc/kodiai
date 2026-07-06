import type { Logger } from "pino";
import {
  projectReviewHandlerCandidatePublicationBridgeEvidence,
  type ReviewHandlerPublicationBridgeProjection,
  type ReviewHandlerPublicationBridgeProjectionInput,
} from "../issue-131/review-handler-publication-bridge.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import { buildCandidateVerificationPublicationEvidenceLogFields } from "../review-orchestration/review-specialist-publication-log.ts";

type ProjectReviewHandlerCandidatePublicationBridge = (
  input: ReviewHandlerPublicationBridgeProjectionInput,
) => ReviewHandlerPublicationBridgeProjection;

export function resolveReviewHandlerCandidatePublicationBridge(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  evidenceSummary?: CandidateVerificationPublicationEvidenceSummary;
  deliveryId: string;
  reviewOutputKey: string;
  upstreamCorrelationKey: string;
  project?: ProjectReviewHandlerCandidatePublicationBridge;
}): ReviewHandlerPublicationBridgeProjection {
  const project = params.project ?? projectReviewHandlerCandidatePublicationBridgeEvidence;

  if (params.evidenceSummary) {
    params.logger.info(
      {
        ...params.baseLog,
        ...buildCandidateVerificationPublicationEvidenceLogFields(params.evidenceSummary),
      },
      "Captured aggregate M070 candidate-verification publication evidence",
    );
  }

  let bridge: ReviewHandlerPublicationBridgeProjection;
  try {
    bridge = project({
      evidenceSummary: params.evidenceSummary,
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      upstreamCorrelationKey: params.upstreamCorrelationKey,
    });
  } catch (err) {
    bridge = project({
      evidenceSummary: null,
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      upstreamCorrelationKey: params.upstreamCorrelationKey,
    });
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "m072-review-handler-publication-bridge",
        gateResult: "degraded",
        reason: "projection-exception",
        err,
        ...bridge.logFields,
      },
      "Review handler candidate-publication bridge projection failed; using bounded degraded evidence",
    );
  }

  params.logger.info(
    {
      ...params.baseLog,
      gate: "m072-review-handler-publication-bridge",
      ...bridge.logFields,
    },
    "Projected review handler candidate-publication bridge evidence",
  );

  return bridge;
}
