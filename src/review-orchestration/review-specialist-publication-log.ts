import { createHash } from "node:crypto";
import type { ShadowSpecialistSubflowResult } from "../specialists/shadow-specialist-subflow.ts";
import { projectShadowSpecialistMetrics } from "../specialists/shadow-specialist-metrics.ts";
import { buildShadowSpecialistReviewDetailsProjection } from "../specialists/shadow-specialist-review-details.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function buildShadowSpecialistCorrelationKey(params: {
  deliveryId?: string | null;
  reviewOutputKey?: string | null;
  prNumber: number;
}): string {
  return sha256Hex(`${params.deliveryId ?? "unknown-delivery"}:${params.reviewOutputKey ?? "unknown-output"}:${params.prNumber}`).slice(0, 16);
}

export function buildShadowSpecialistLogFields(result: ShadowSpecialistSubflowResult): Record<string, unknown> {
  try {
    const metricsProjection = projectShadowSpecialistMetrics(result);
    const reviewDetailsProjection = buildShadowSpecialistReviewDetailsProjection(metricsProjection);

    return {
      gate: "shadow-specialist",
      laneId: reviewDetailsProjection.laneId,
      status: result.triggerStatus,
      outputStatus: reviewDetailsProjection.status,
      reason: reviewDetailsProjection.reason,
      candidateCount: reviewDetailsProjection.candidateCount,
      decisionCount: reviewDetailsProjection.decisionCount,
      decisionCounts: reviewDetailsProjection.decisionCounts,
      duplicateCount: reviewDetailsProjection.duplicateCount,
      disagreementCount: reviewDetailsProjection.disagreementCount,
      dismissedCount: reviewDetailsProjection.dismissedCount,
      unclassifiableCount: reviewDetailsProjection.unclassifiableCount,
      truncatedCandidateCount: reviewDetailsProjection.truncatedCandidateCount,
      durationMs: result.durationMs,
      deliveryId: reviewDetailsProjection.deliveryId,
      reviewOutputKey: reviewDetailsProjection.reviewOutputKey,
      correlationKey: reviewDetailsProjection.correlationKey,
      metricAvailability: reviewDetailsProjection.metricAvailability,
      tokenCountAvailable: reviewDetailsProjection.tokenCountAvailable,
      costAvailable: reviewDetailsProjection.costAvailable,
      latencyMsAvailable: reviewDetailsProjection.latencyMsAvailable,
      unsafeFieldCount: reviewDetailsProjection.redactionFlags.unsafeFieldCount,
      discardedRawPayload: reviewDetailsProjection.redactionFlags.discardedRawPayload,
      discardedPublicationFields: reviewDetailsProjection.redactionFlags.discardedPublicationFields,
      discardedApprovalFields: reviewDetailsProjection.redactionFlags.discardedApprovalFields,
      privateOnly: reviewDetailsProjection.privateOnly,
      shadowOnly: reviewDetailsProjection.shadowOnly,
      publishesFindings: reviewDetailsProjection.publishesFindings,
      visiblePublicationDenied: reviewDetailsProjection.visiblePublicationDenied,
      approvalPublicationDenied: reviewDetailsProjection.approvalPublicationDenied,
      rawContentFieldCount: reviewDetailsProjection.rawContentFieldCount,
      candidateBodyFieldCount: reviewDetailsProjection.candidateBodyFieldCount,
      githubPublicationFieldCount: reviewDetailsProjection.githubPublicationFieldCount,
      approvalFieldCount: reviewDetailsProjection.approvalFieldCount,
      specialistContentIncluded: reviewDetailsProjection.specialistContentIncluded,
      candidateFingerprintsIncluded: reviewDetailsProjection.candidateFingerprintsIncluded,
      candidateBodiesIncluded: reviewDetailsProjection.candidateBodiesIncluded,
      rawModelOutputIncluded: reviewDetailsProjection.rawModelOutputIncluded,
      toolPayloadIncluded: reviewDetailsProjection.toolPayloadIncluded,
      approvalFieldsIncluded: reviewDetailsProjection.approvalFieldsIncluded,
      tierModeIncluded: reviewDetailsProjection.tierModeIncluded,
      s04EvidenceAvailable: true,
      reviewDetailsProjectionAvailable: true,
      reviewDetailsProjectionStatus: reviewDetailsProjection.status,
      reviewDetailsLineAvailable: reviewDetailsProjection.reviewDetailsLine.length > 0,
      metricBoundedness: "bounded-aggregate-only",
      metricBoundednessAvailable: true,
      metricProjectionDegraded: false,
      compactReviewDetailsPrivateOnly: reviewDetailsProjection.privateOnly,
      compactReviewDetailsShadowOnly: reviewDetailsProjection.shadowOnly,
      compactReviewDetailsVisiblePublicationDenied: reviewDetailsProjection.visiblePublicationDenied,
      compactReviewDetailsApprovalPublicationDenied: reviewDetailsProjection.approvalPublicationDenied,
    };
  } catch {
    return {
      gate: "shadow-specialist",
      laneId: result.laneId ?? "docs-config-truth",
      status: "degraded",
      outputStatus: "degraded",
      reason: "metrics-projection-error",
      durationMs: result.durationMs,
      deliveryId: result.deliveryId,
      reviewOutputKey: result.reviewOutputKey,
      correlationKey: result.correlationKey,
      privateOnly: true,
      shadowOnly: true,
      publishesFindings: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      specialistContentIncluded: false,
      candidateFingerprintsIncluded: false,
      candidateBodiesIncluded: false,
      rawModelOutputIncluded: false,
      toolPayloadIncluded: false,
      approvalFieldsIncluded: false,
      tierModeIncluded: false,
      s04EvidenceAvailable: false,
      reviewDetailsProjectionAvailable: false,
      reviewDetailsProjectionStatus: "degraded",
      reviewDetailsLineAvailable: false,
      metricBoundedness: "bounded-aggregate-only",
      metricBoundednessAvailable: false,
      metricProjectionDegraded: true,
    };
  }
}

export function buildCandidateVerificationPublicationEvidenceLogFields(
  evidence: CandidateVerificationPublicationEvidenceSummary,
): Record<string, unknown> {
  return {
    gate: "m070-candidate-verification-evidence",
    aggregateStatus: evidence.aggregateStatus,
    attemptedCount: evidence.counts.attempted,
    allowedCount: evidence.counts.allowed,
    deniedCount: evidence.counts.denied,
    publishedCount: evidence.counts.published,
    skippedCount: evidence.counts.skipped,
    issueCount: evidence.counts.failed,
    publicationDenialCounts: evidence.publicationDenialCounts,
    reasonCategories: evidence.reasonCategories,
    verificationStateCounts: evidence.verificationStateCounts,
    candidateVerificationCounts: evidence.candidateVerificationCounts,
    hasDeliveryId: evidence.metadata.hasDeliveryId,
    hasReviewOutputKey: evidence.metadata.hasReviewOutputKey,
    hasCorrelationKey: evidence.metadata.hasCorrelationKey,
    deliveryId: evidence.metadata.deliveryId,
    reviewOutputKey: evidence.metadata.reviewOutputKey,
    correlationKey: evidence.metadata.correlationKey,
    privateOnly: evidence.redactionFlags.privateOnly,
    candidateBodiesIncluded: evidence.redactionFlags.candidateBodiesIncluded,
    specialistProseIncluded: evidence.redactionFlags.specialistProseIncluded,
    rawPromptsIncluded: evidence.redactionFlags.rawPromptsIncluded,
    rawModelOutputIncluded: evidence.redactionFlags.rawModelOutputIncluded,
    diffsIncluded: evidence.redactionFlags.diffsIncluded,
    evidencePayloadsIncluded: evidence.redactionFlags.evidencePayloadsIncluded,
    rawFingerprintsIncluded: evidence.redactionFlags.rawFingerprintsIncluded,
    publicationEvidenceIncluded: evidence.redactionFlags.publicationEvidenceIncluded,
    unsafeInputFieldCount: evidence.redactionFlags.unsafeInputFieldCount,
    discardedRawPayload: evidence.redactionFlags.discardedRawPayload,
    discardedPublicationFields: evidence.redactionFlags.discardedPublicationFields,
    discardedEvidencePayloads: evidence.redactionFlags.discardedEvidencePayloads,
    candidateAttemptIncluded: evidence.redactionFlags.candidateAttemptIncluded,
    candidateKeyIncluded: evidence.redactionFlags.candidateKeyIncluded,
    boundedness: "aggregate-only",
  };
}
