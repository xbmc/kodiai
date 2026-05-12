import type { NormalizedShadowSpecialistOutput, ShadowSpecialistDecisionCounts } from "./shadow-specialist.ts";
import type { ShadowSpecialistSubflowResult } from "./shadow-specialist-subflow.ts";

export type ShadowSpecialistMetricAvailabilityProjection = {
  readonly tokenCount: "available" | "unavailable";
  readonly costUsd: "available" | "unavailable";
  readonly latencyMs: "available" | "unavailable";
};

export type ShadowSpecialistMetricsProjection = {
  readonly laneId: NormalizedShadowSpecialistOutput["laneId"];
  readonly status: NormalizedShadowSpecialistOutput["status"];
  readonly reason: string | null;
  readonly deliveryId: string | null;
  readonly reviewOutputKey: string | null;
  readonly correlationKey: string | null;
  readonly candidateCount: number;
  readonly decisionCount: number;
  readonly decisionCounts: ShadowSpecialistDecisionCounts;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly dismissedCount: number;
  readonly unclassifiableCount: number;
  readonly truncatedCandidateCount: number;
  readonly metricAvailability: ShadowSpecialistMetricAvailabilityProjection;
  readonly tokenCountAvailable: boolean;
  readonly costAvailable: boolean;
  readonly latencyMsAvailable: boolean;
  readonly redactionFlags: NormalizedShadowSpecialistOutput["redactionFlags"];
  readonly privateOnly: true;
  readonly shadowOnly: true;
  readonly publishesFindings: false;
  readonly visiblePublicationDenied: true;
  readonly approvalPublicationDenied: true;
  readonly rawContentFieldCount: 0;
  readonly candidateBodyFieldCount: 0;
  readonly githubPublicationFieldCount: 0;
  readonly approvalFieldCount: 0;
  readonly specialistContentIncluded: false;
  readonly candidateFingerprintsIncluded: false;
  readonly candidateBodiesIncluded: false;
  readonly rawModelOutputIncluded: false;
  readonly toolPayloadIncluded: false;
  readonly approvalFieldsIncluded: false;
  readonly tierModeIncluded: false;
};

export type ShadowSpecialistMetricsInput = NormalizedShadowSpecialistOutput | ShadowSpecialistSubflowResult;

export function projectShadowSpecialistMetrics(input: ShadowSpecialistMetricsInput): ShadowSpecialistMetricsProjection {
  const output = isSubflowResult(input) ? input.output : input;
  const reason = isSubflowResult(input)
    ? resolveSubflowReason(input)
    : resolveOutputReason(output);

  return {
    laneId: output.laneId,
    status: output.status,
    reason,
    deliveryId: output.deliveryId,
    reviewOutputKey: output.reviewOutputKey,
    correlationKey: isSubflowResult(input) ? input.correlationKey : output.correlationKey,
    candidateCount: output.candidateCount,
    decisionCount: output.metrics.decisionCount,
    decisionCounts: { ...output.decisionCounts },
    duplicateCount: output.duplicateCount,
    disagreementCount: output.disagreementCount,
    dismissedCount: output.decisionCounts.dismissed,
    unclassifiableCount: output.decisionCounts.unclassifiable,
    truncatedCandidateCount: output.truncatedCandidateCount,
    metricAvailability: { ...output.metricAvailability },
    tokenCountAvailable: output.metricAvailability.tokenCount === "available",
    costAvailable: output.metricAvailability.costUsd === "available",
    latencyMsAvailable: output.metricAvailability.latencyMs === "available",
    redactionFlags: { ...output.redactionFlags },
    privateOnly: true,
    shadowOnly: true,
    publishesFindings: false,
    visiblePublicationDenied: true,
    approvalPublicationDenied: true,
    rawContentFieldCount: 0,
    candidateBodyFieldCount: 0,
    githubPublicationFieldCount: 0,
    approvalFieldCount: 0,
    specialistContentIncluded: false,
    candidateFingerprintsIncluded: false,
    candidateBodiesIncluded: false,
    rawModelOutputIncluded: false,
    toolPayloadIncluded: false,
    approvalFieldsIncluded: false,
    tierModeIncluded: false,
  };
}

function isSubflowResult(input: ShadowSpecialistMetricsInput): input is ShadowSpecialistSubflowResult {
  return "output" in input && typeof input.output === "object" && input.output !== null;
}

function resolveSubflowReason(result: ShadowSpecialistSubflowResult): string | null {
  return result.timeoutReason
    ?? result.errorReason
    ?? result.unclassifiableReason
    ?? result.skipReason
    ?? result.degradedReason
    ?? result.errorKind
    ?? resolveOutputReason(result.output);
}

function resolveOutputReason(output: NormalizedShadowSpecialistOutput): string | null {
  return output.errorKind
    ?? output.skipReason
    ?? output.degradedReasons[0]
    ?? null;
}
