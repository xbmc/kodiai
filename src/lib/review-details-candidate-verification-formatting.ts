import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import {
  boundedReviewDetailsValue,
  formatCountFields,
  formatReasonCountFields,
  formatStringArray,
  readNonNegativeCount,
} from "./review-details-shared-formatting.ts";

export type CandidateVerificationPublicationEvidenceReviewDetails = CandidateVerificationPublicationEvidenceSummary;

function formatCandidateVerificationMetadata(
  metadata: CandidateVerificationPublicationEvidenceSummary["metadata"],
): string {
  return [
    `deliveryId:${metadata.hasDeliveryId === true ? "y" : "n"}`,
    `reviewOutputKey:${metadata.hasReviewOutputKey === true ? "y" : "n"}`,
    `correlationKey:${metadata.hasCorrelationKey === true ? "y" : "n"}`,
  ].join(",");
}

function formatRedactionFlags(
  flags: CandidateVerificationPublicationEvidenceSummary["redactionFlags"],
): string {
  return [
    `privateOnly:${flags.privateOnly === false ? "n" : "y"}`,
    `candidateBodies:${flags.candidateBodiesIncluded === true ? "y" : "n"}`,
    `specialistProse:${flags.specialistProseIncluded === true ? "y" : "n"}`,
    `rawPrompts:${flags.rawPromptsIncluded === true ? "y" : "n"}`,
    `rawModelOutput:${flags.rawModelOutputIncluded === true ? "y" : "n"}`,
    `diffs:${flags.diffsIncluded === true ? "y" : "n"}`,
    `evidencePayloads:${flags.evidencePayloadsIncluded === true ? "y" : "n"}`,
    `rawFingerprints:${flags.rawFingerprintsIncluded === true ? "y" : "n"}`,
    `publicationEvidence:${flags.publicationEvidenceIncluded === true ? "y" : "n"}`,
    `unsafeFields:${readNonNegativeCount(flags, "unsafeInputFieldCount")}`,
  ].join(",");
}

export function formatCandidateVerificationPublicationEvidenceLine(
  evidence?: CandidateVerificationPublicationEvidenceReviewDetails | null,
): string | null {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    return null;
  }

  const status = boundedReviewDetailsValue(evidence.aggregateStatus, 32) ?? "unavailable";
  const counts = formatCountFields(evidence.counts, ["attempted", "allowed", "denied", "published", "skipped", "failed"]);
  if (!counts) return null;
  const verification = formatCountFields(evidence.verificationStateCounts, ["verified", "partially_verified", "unverified", "disproven", "unavailable"])
    ?? "verified:0,partially_verified:0,unverified:0,disproven:0,unavailable:0";
  const candidateCounts = formatCountFields(evidence.candidateVerificationCounts, ["candidateCount", "evidenceCount", "verifiedCount", "partiallyVerifiedCount", "unverifiedCount", "disprovenCount", "publicationEligibleCount"])
    ?? "candidateCount:0,evidenceCount:0,verifiedCount:0,partiallyVerifiedCount:0,unverifiedCount:0,disprovenCount:0,publicationEligibleCount:0";

  return `- M070 candidate verification publication: status=${status}; counts=${counts}; verification=${verification}; candidateVerification=${candidateCounts}; denialCounts=${formatReasonCountFields(evidence.publicationDenialCounts)}; reasons=${formatStringArray(evidence.reasonCategories)}; metadata=${formatCandidateVerificationMetadata(evidence.metadata)}; redaction=${formatRedactionFlags(evidence.redactionFlags)}`;
}
