import type { Logger } from "pino";
import type {
  ReviewCandidatePublicationAdapterDetailsSummary,
  ReviewCandidatePublicationAdapterResult,
} from "../review-orchestration/review-candidate-publication-adapter.ts";

export function logReviewCandidatePublicationAdapterContext(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  reviewOutputKey: string;
  deliveryId: string;
  adapter: ReviewCandidatePublicationAdapterResult;
  detailsSummary: ReviewCandidatePublicationAdapterDetailsSummary;
}): void {
  const { logger, baseLog, reviewOutputKey, deliveryId, adapter, detailsSummary } = params;

  logger.info(
    {
      ...baseLog,
      gate: "review-fix-eligibility",
      gateResult: adapter.summary.fixEligibility.status,
      reviewOutputKey,
      deliveryId,
      schema: adapter.summary.fixEligibility.schema,
      counts: adapter.summary.fixEligibility.counts,
      reasonCounts: adapter.summary.fixEligibility.reasonCounts,
      omittedReasonCounts: adapter.summary.fixEligibility.omittedReasonCounts,
      redaction: adapter.summary.fixEligibility.redaction,
    },
    "Review fix eligibility summarized",
  );
  logger.info(
    {
      ...baseLog,
      gate: "review-candidate-publication-adapter",
      gateResult: adapter.summary.counts.publishable > 0 ? "publishable" : "skipped",
      counts: adapter.summary.counts,
      skipped: adapter.summary.skipped,
      payloadFingerprints: adapter.summary.fingerprints,
      fixEligibility: adapter.summary.fixEligibility,
      details: detailsSummary.text,
    },
    "Review candidate publication adapter summarized",
  );
}
