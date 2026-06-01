import type { ReviewHandlerPublicationBridgeReviewDetails } from "../review-orchestration/review-candidate-publication-bridge-details.ts";
import {
  boundedBridgeToken,
  formatBridgeTokenArray,
  formatCountFields,
} from "./review-details-shared-formatting.ts";

export type CandidatePublicationBridgeReviewDetails = ReviewHandlerPublicationBridgeReviewDetails;

function hasUnsafeBridgeRedaction(redaction: ReviewHandlerPublicationBridgeReviewDetails["redaction"]): boolean {
  return redaction.privateOnly !== true
    || redaction.rawPayloadsIncluded !== false
    || redaction.publicationFieldsIncluded !== false
    || redaction.evidencePayloadsIncluded !== false
    || redaction.githubCommentBodyIncluded !== false
    || redaction.reducerHandoffIncludesRawPayload !== false;
}

function formatBridgeRedactionFlags(redaction: ReviewHandlerPublicationBridgeReviewDetails["redaction"]): string {
  return [
    `privateOnly:${redaction.privateOnly === true ? "y" : "n"}`,
    `rawPayloads:${redaction.rawPayloadsIncluded === true ? "y" : "n"}`,
    `publicationFields:${redaction.publicationFieldsIncluded === true ? "y" : "n"}`,
    `evidencePayloads:${redaction.evidencePayloadsIncluded === true ? "y" : "n"}`,
    `githubCommentBody:${redaction.githubCommentBodyIncluded === true ? "y" : "n"}`,
    `reducerRawPayload:${redaction.reducerHandoffIncludesRawPayload === true ? "y" : "n"}`,
    `discardedRawPayload:${redaction.discardedRawPayload === true ? "y" : "n"}`,
    `discardedPublicationFields:${redaction.discardedPublicationFields === true ? "y" : "n"}`,
    `discardedEvidencePayloads:${redaction.discardedEvidencePayloads === true ? "y" : "n"}`,
  ].join(",");
}

function formatBridgePresence(presence: ReviewHandlerPublicationBridgeReviewDetails["presence"]): string {
  return [
    `deliveryId:${presence.hasDeliveryId === true ? "y" : "n"}`,
    `reviewOutputKey:${presence.hasReviewOutputKey === true ? "y" : "n"}`,
    `upstreamCorrelationKey:${presence.hasUpstreamCorrelationKey === true ? "y" : "n"}`,
    `policyCorrelationKey:${presence.hasPolicyCorrelationKey === true ? "y" : "n"}`,
  ].join(",");
}

export function formatCandidatePublicationBridgeLine(
  bridge?: CandidatePublicationBridgeReviewDetails | null,
): string | null {
  if (bridge === undefined || bridge === null) return null;
  if (typeof bridge !== "object" || Array.isArray(bridge)) {
    return "- M072 candidate publication bridge: status=unavailable; reasons=malformed-bridge-projection; handoffOwner=unavailable; redaction=privateOnly:y,rawPayloads:n,publicationFields:n,evidencePayloads:n,githubCommentBody:n,reducerRawPayload:n,discardedRawPayload:n,discardedPublicationFields:n,discardedEvidencePayloads:n";
  }

  const status = boundedBridgeToken(bridge.status, "unavailable", 32);
  const validStatus = status === "allowed" || status === "denied" || status === "malformed" || status === "unavailable";
  const unsafeRedaction = hasUnsafeBridgeRedaction(bridge.redaction);
  if (!validStatus || unsafeRedaction) {
    return `- M072 candidate publication bridge: status=unavailable; reasons=${unsafeRedaction ? "unsafe-redaction-flags" : "malformed-bridge-projection"}; handoffOwner=unavailable; redaction=${formatBridgeRedactionFlags(bridge.redaction)}`;
  }

  const counts = formatCountFields(bridge.counts, [
    "candidateCount",
    "evidenceCount",
    "verifiedCount",
    "partiallyVerifiedCount",
    "unverifiedCount",
    "disprovenCount",
    "publicationEligibleCount",
    "malformedRecordCount",
    "unsafeInputFieldCount",
  ]) ?? "candidateCount:0,evidenceCount:0,verifiedCount:0,partiallyVerifiedCount:0,unverifiedCount:0,disprovenCount:0,publicationEligibleCount:0,malformedRecordCount:0,unsafeInputFieldCount:0";
  const handoffOwner = bridge.reducerHandoffAvailable === true ? "available" : "unavailable";

  return [
    `- M072 candidate publication bridge: status=${status}`,
    `bridgeVersion=${boundedBridgeToken(bridge.bridgeVersion)}`,
    `bridgeId=${boundedBridgeToken(bridge.bridgeId)}`,
    `recordKey=${boundedBridgeToken(bridge.recordKey)}`,
    `correlationKey=${boundedBridgeToken(bridge.correlationKey)}`,
    `source=${boundedBridgeToken(bridge.sourceLabel)}`,
    `candidateRef=${boundedBridgeToken(bridge.candidateRef)}`,
    `verification=${bridge.verificationState === null ? "none" : boundedBridgeToken(bridge.verificationState, "unavailable", 32)}`,
    `counts=${counts}`,
    `reasons=${formatBridgeTokenArray(bridge.reasonCategories)}`,
    `malformed=${formatBridgeTokenArray(bridge.malformedReasonCodes)}`,
    `presence=${formatBridgePresence(bridge.presence)}`,
    `handoffOwner=${handoffOwner}`,
    `redaction=${formatBridgeRedactionFlags(bridge.redaction)}`,
  ].join("; ");
}
