import type { ReviewCandidateFindingDetailsSummary } from "../review-orchestration/review-candidate-finding.ts";
import type { ReviewCandidatePublicationRuntimeDetailsSummary } from "../review-orchestration/review-candidate-publication-runtime.ts";
import type { ReviewHandlerPublicationBridgeReviewDetails } from "../issue-131/review-handler-publication-bridge.ts";
import type { CandidateVerificationPublicationEvidenceSummary } from "../specialists/candidate-verification-publication-evidence.ts";
import {
  boundedReviewDetailsValue,
  formatCountFields,
  formatReasonCountFields,
  formatStringArray,
  readNonNegativeCount,
} from "./review-details-shared-formatting.ts";

export type CandidatePublicationBridgeReviewDetails = ReviewHandlerPublicationBridgeReviewDetails;
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

export function formatReviewCandidateFindingDetailsLine(
  reviewCandidateFinding?: ReviewCandidateFindingDetailsSummary | null,
): string[] {
  try {
    if (reviewCandidateFinding?.label !== "Review candidates") return [];
    if (
      reviewCandidateFinding.status !== "shadow"
      && reviewCandidateFinding.status !== "unavailable"
      && reviewCandidateFinding.status !== "degraded"
    ) {
      return [];
    }

    const text = typeof reviewCandidateFinding.text === "string"
      ? sanitizeReviewCandidateDetailsText(reviewCandidateFinding.text)
      : "";
    if (!text || !text.startsWith("Review candidates:")) return [];
    return [`- ${text}`];
  } catch {
    return [];
  }
}

function sanitizeReviewCandidateDetailsText(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 260);
}

const REVIEW_CANDIDATE_PUBLICATION_MODES = new Set([
  "candidate-approved",
  "candidate-approved-partial",
  "moved-to-details",
  "direct-fallback",
  "fallback-disallowed",
  "blocked",
  "degraded",
]);
const MAX_REVIEW_CANDIDATE_PUBLICATION_REASONS = 6;
const MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKETS = 8;
const MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKET_REASONS = 8;
const MAX_REVIEW_CANDIDATE_DETAILS_ONLY_FINDINGS = 5;
const MAX_REVIEW_CANDIDATE_DETAILS_ONLY_EXCERPT_LENGTH = 160;

export function formatReviewCandidatePublicationDetailsLine(
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary | null,
): string[] {
  try {
    if (!reviewCandidatePublication) return [];
    if (reviewCandidatePublication.label !== "Review candidate publication runtime") return [];
    if (typeof reviewCandidatePublication.text !== "string" || reviewCandidatePublication.text.trim().length === 0) {
      return [formatMalformedReviewCandidatePublicationDetailsLine()];
    }

    const normalized = normalizeReviewCandidatePublicationDetailsText(reviewCandidatePublication.text, reviewCandidatePublication);
    if (!normalized) return [formatMalformedReviewCandidatePublicationDetailsLine()];
    return [`- ${normalized}`, ...formatReviewCandidateMovedToDetailsLines(reviewCandidatePublication)];
  } catch {
    return [formatMalformedReviewCandidatePublicationDetailsLine()];
  }
}

function normalizeReviewCandidatePublicationDetailsText(
  value: string,
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary,
): string | null {
  const text = sanitizeReviewCandidatePublicationDetailsText(value);
  const match = text.match(/^Review candidate publication runtime:\s+(\S+)\s*/);
  if (!match) return null;

  const rawMode = sanitizeReviewCandidatePublicationToken(match[1] ?? "degraded");
  const mode = REVIEW_CANDIDATE_PUBLICATION_MODES.has(rawMode) ? rawMode : "degraded";
  const approved = extractCandidatePublicationCount(text, "approvedRefs");
  const rewritten = extractCandidatePublicationCount(text, "rewrittenRefs");
  const publishable = extractCandidatePublicationCount(text, "publishable");
  const nonPublishable = extractCandidatePublicationCount(text, "nonPublishable");
  const fixBlocked = extractCandidatePublicationCount(text, "fixBlocked");
  const published = extractCandidatePublicationCount(text, "candidatePublished");
  const movedToDetails = extractCandidatePublicationCount(text, "movedToDetails");
  const detailsOmitted = extractCandidatePublicationCount(text, "detailsOmitted");
  const directFallback = Math.max(
    extractCandidatePublicationCount(text, "fallbackEvidence"),
    extractCandidatePublicationCount(text, "directPublished"),
  );
  const reasons = formatReviewCandidatePublicationReasons(text);
  const buckets = formatReviewCandidatePublicationOutcomeBuckets(reviewCandidatePublication);

  return `Review candidate publication: mode=${mode} approved=${approved} rewritten=${rewritten} publishable=${publishable} nonPublishable=${nonPublishable} fixBlocked=${fixBlocked} published=${published} directFallback=${directFallback} reasons=${reasons} movedToDetails=${movedToDetails} detailsOmitted=${detailsOmitted}${buckets ? ` buckets=${buckets}` : ""}`;
}


function formatReviewCandidatePublicationOutcomeBuckets(
  reviewCandidatePublication?: ReviewCandidatePublicationRuntimeDetailsSummary,
): string | null {
  const rawBuckets = (reviewCandidatePublication as { outcomeBuckets?: unknown } | undefined)?.outcomeBuckets;
  if (typeof rawBuckets !== "object" || rawBuckets === null || Array.isArray(rawBuckets)) return null;

  const entries: string[] = [];
  let omittedReasons = 0;
  const orderedKeys = ["published", "skipped", "blocked", "failed", "movedToDetails", "directFallback", "fallbackDisallowed", "degraded"] as const;
  for (const key of orderedKeys) {
    if (entries.length >= MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKETS) break;
    const bucket = (rawBuckets as Record<string, unknown>)[key];
    if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) continue;
    const record = bucket as Record<string, unknown>;
    const count = readNonNegativeCount(record, "count");
    if (count <= 0) continue;
    const mode = sanitizeReviewCandidatePublicationBucketMode(record.mode, key);
    const rawReasons = Array.isArray(record.reasons) ? record.reasons : [];
    const safeReasons = rawReasons
      .map((reason) => typeof reason === "string" ? sanitizeReviewCandidatePublicationToken(reason) : "")
      .filter(isSafeReviewCandidatePublicationBucketReason);
    if (mode !== "degraded") {
      omittedReasons += Math.max(0, rawReasons.length - safeReasons.length);
    }
    const cappedReasons = safeReasons.slice(0, MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKET_REASONS);
    omittedReasons += Math.max(0, safeReasons.length - cappedReasons.length);
    entries.push(`${mode}:${count}:${cappedReasons.length > 0 ? cappedReasons.join("+") : "unknown-safe-reason"}`);
  }

  if (entries.length === 0) return null;
  return `${entries.join(",")}${omittedReasons > 0 ? ` +${omittedReasons} bucketReasonsOmitted` : ""}`;
}

function sanitizeReviewCandidatePublicationBucketMode(value: unknown, key: string): string {
  const mode = typeof value === "string" ? sanitizeReviewCandidatePublicationToken(value) : "";
  if (mode) return mode;
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isSafeReviewCandidatePublicationBucketReason(value: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(value)) return false;
  return !/(redacted|prompt|diff|token|secret|unsafe|raw|canary|hidden)/.test(value);
}

function formatReviewCandidateMovedToDetailsLines(
  reviewCandidatePublication: ReviewCandidatePublicationRuntimeDetailsSummary,
): string[] {
  try {
    if (!hasSafeMovedToDetailsRedaction(reviewCandidatePublication.movedToDetails)) return [];
    const findings = Array.isArray(reviewCandidatePublication.detailsOnlyFindings)
      ? reviewCandidatePublication.detailsOnlyFindings
      : [];
    if (findings.length === 0) return [];

    const rendered = findings
      .map(formatReviewCandidateMovedFindingLine)
      .filter((line): line is string => Boolean(line))
      .slice(0, MAX_REVIEW_CANDIDATE_DETAILS_ONLY_FINDINGS);
    if (rendered.length === 0) return [];

    const total = readNonNegativeCount(reviewCandidatePublication.movedToDetails?.counts ?? {}, "total");
    const explicitOmitted = readNonNegativeCount(reviewCandidatePublication.movedToDetails?.counts ?? {}, "omitted");
    const omitted = Math.max(0, total - rendered.length, explicitOmitted, findings.length - rendered.length);
    return [
      "- Moved review candidates preserved in details:",
      ...rendered,
      ...(omitted > 0 ? [`  - ...and ${omitted} more omitted (bounded-details-only)`] : []),
    ];
  } catch {
    return [];
  }
}

function hasSafeMovedToDetailsRedaction(summary: ReviewCandidatePublicationRuntimeDetailsSummary["movedToDetails"]): boolean {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  const redaction = summary.redaction;
  if (typeof redaction !== "object" || redaction === null || Array.isArray(redaction)) return false;
  return redaction.rawCandidatePayloadsIncluded === false
    && redaction.rawPromptsIncluded === false
    && redaction.rawModelOutputIncluded === false
    && redaction.diffsIncluded === false
    && redaction.replacementTextIncluded === false
    && redaction.githubResponsePayloadsIncluded === false
    && redaction.secretLikeValuesIncluded === false
    && redaction.bounded === true;
}

function formatReviewCandidateMovedFindingLine(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const finding = value as Record<string, unknown>;
  const location = typeof finding.location === "object" && finding.location !== null && !Array.isArray(finding.location)
    ? finding.location as Record<string, unknown>
    : null;
  if (!location) return null;

  const title = sanitizeMovedDetailsText(finding.title, 96) ?? "Untitled finding";
  const severity = sanitizeReviewCandidatePublicationToken(String(finding.severity ?? "medium"));
  const category = sanitizeReviewCandidatePublicationToken(String(finding.category ?? "correctness"));
  const path = sanitizeMovedDetailsPath(location.path);
  const line = readPositiveInteger(location.line);
  const reason = sanitizeReviewCandidatePublicationToken(String(finding.reason ?? "unknown-safe-reason")) || "unknown-safe-reason";
  if (!path || !line) return null;

  const excerpt = sanitizeMovedDetailsText(finding.excerpt, MAX_REVIEW_CANDIDATE_DETAILS_ONLY_EXCERPT_LENGTH);
  return `  - [${severity}/${category}] ${title} (${path}:${line}, reason=${reason})${excerpt ? ` — ${excerpt}` : ""}`;
}

function sanitizeMovedDetailsPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^b\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || /^[a-zA-Z]:[\\/]/.test(normalized)) return null;
  return sanitizeMovedDetailsText(normalized, 160);
}

function sanitizeMovedDetailsText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const normalized = String(value)
    .replace(/```suggestion[\s\S]*?```/gi, "[fix-redacted]")
    .replace(/diff --git[\s\S]*/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT[\s\S]*/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .replace(/TOKEN\s*[:=]\s*[^\s]+/gi, "token-redacted")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "redacted")
    .replace(/[\r\n|\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
}

function formatMalformedReviewCandidatePublicationDetailsLine(): string {
  return "- Review candidate publication: mode=degraded approved=0 rewritten=0 publishable=0 nonPublishable=0 fixBlocked=0 published=0 directFallback=0 reasons=malformed-runtime-summary movedToDetails=0 detailsOmitted=0 buckets=degraded:1:malformed-runtime-summary";
}

function extractCandidatePublicationCount(text: string, key: string): number {
  const match = text.match(new RegExp(`(?:^|\\s)${key}=(-?\\d+)`));
  if (!match) return 0;
  const value = Number.parseInt(match[1] ?? "0", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatReviewCandidatePublicationReasons(text: string): string {
  const marker = "reasons=";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return "none";

  const reasonText = text.slice(markerIndex + marker.length).trim();
  if (!reasonText || reasonText === "none") return "none";

  const reasons = reasonText
    .split(",")
    .map((reason) => sanitizeReviewCandidatePublicationToken(reason))
    .filter((reason) => reason.length > 0);

  if (reasons.length === 0) return "none";

  const cappedReasons = reasons.slice(0, MAX_REVIEW_CANDIDATE_PUBLICATION_REASONS);
  const remaining = reasons.length - cappedReasons.length;
  return remaining > 0 ? `${cappedReasons.join(",")} +${remaining} more` : cappedReasons.join(",");
}

function sanitizeReviewCandidatePublicationDetailsText(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 1_000);
}

function sanitizeReviewCandidatePublicationToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

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
