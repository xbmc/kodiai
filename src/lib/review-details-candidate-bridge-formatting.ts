import type { ReviewHandlerPublicationBridgeReviewDetails } from "../review-orchestration/review-candidate-publication-bridge-details.ts";
import {
  boundedReviewDetailsValue,
  formatCountFields,
} from "./review-details-shared-formatting.ts";

export type CandidatePublicationBridgeReviewDetails = ReviewHandlerPublicationBridgeReviewDetails;

function boundedBridgeToken(value: unknown, fallback = "unavailable", maxLength = 160): string {
  const text = boundedReviewDetailsValue(value, maxLength);
  if (!text || !/^[a-z0-9][a-z0-9:._-]*$/.test(text)) return fallback;
  return text;
}

function formatBridgeStringArray(value: unknown, maxItems = 8): string {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .map((entry) => boundedBridgeToken(entry, "", 64))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(",") : "none";
}

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
    `reasons=${formatBridgeStringArray(bridge.reasonCategories)}`,
    `malformed=${formatBridgeStringArray(bridge.malformedReasonCodes)}`,
    `presence=${formatBridgePresence(bridge.presence)}`,
    `handoffOwner=${handoffOwner}`,
    `redaction=${formatBridgeRedactionFlags(bridge.redaction)}`,
  ].join("; ");
}
