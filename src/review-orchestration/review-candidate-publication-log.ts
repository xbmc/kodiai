import type { Logger } from "pino";
import {
  toProductionLogCandidatePublicationBuckets,
  toProductionLogCandidatePublicationCounts,
  toProductionLogCandidatePublicationPublisherSample,
  toProductionLogCandidatePublicationReason,
} from "../review-audit/production-log-projection.ts";
import {
  isExpectedCandidatePublicationPolicyBlock,
  type ReviewCandidatePublicationRuntimeResult,
} from "./review-candidate-publication-runtime.ts";

export function logReviewCandidatePublicationRuntime(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  runtime: ReviewCandidatePublicationRuntimeResult;
}): void {
  try {
    const payload = {
      ...params.baseLog,
      gate: "review-candidate-publication",
      gateResult: params.runtime.mode,
      mode: params.runtime.mode,
      counts: toProductionLogCandidatePublicationCounts(params.runtime.counts),
      reasons: params.runtime.reasons.map(toProductionLogCandidatePublicationReason),
      outcomeBuckets: toProductionLogCandidatePublicationBuckets(params.runtime.outcomeBuckets),
      publisherResultSample: toProductionLogCandidatePublicationPublisherSample(params.runtime.publisherResultSample),
      movedToDetails: params.runtime.movedToDetails,
    };

    const expectedPolicyBlocked = isExpectedCandidatePublicationPolicyBlock(params.runtime);

    if (expectedPolicyBlocked) {
      params.logger.info(payload, "Review candidate publication completed with expected policy block");
      return;
    }

    if (params.runtime.mode === "degraded" || params.runtime.mode === "blocked" || params.runtime.mode === "fallback-disallowed") {
      params.logger.warn(payload, "Review candidate publication completed with non-approved mode");
      return;
    }

    params.logger.info(payload, "Review candidate publication completed");
  } catch (error) {
    params.logger.warn(
      {
        ...params.baseLog,
        gate: "review-candidate-publication",
        gateResult: "degraded",
        mode: "degraded",
        reasons: ["malformed-runtime-summary"],
        logError: error instanceof Error ? error.message : String(error),
      },
      "Review candidate publication runtime log degraded",
    );
  }
}
