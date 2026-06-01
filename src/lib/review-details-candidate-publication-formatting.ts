import type {
  ReviewCandidatePublicationRuntimeCounts,
  ReviewCandidatePublicationRuntimeDetailsSummary,
  ReviewCandidatePublicationRuntimeMode,
  ReviewCandidatePublicationRuntimeOutcomeBucket,
  ReviewCandidatePublicationRuntimeOutcomeBuckets,
  ReviewCandidatePublicationRuntimeReason,
} from "../review-orchestration/review-candidate-publication-runtime.ts";

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

    const normalized = formatReviewCandidatePublicationDetailsText(reviewCandidatePublication);
    if (!normalized) return [formatMalformedReviewCandidatePublicationDetailsLine()];
    return [`- ${normalized}`, ...formatReviewCandidateMovedToDetailsLines(reviewCandidatePublication)];
  } catch {
    return [formatMalformedReviewCandidatePublicationDetailsLine()];
  }
}

function formatReviewCandidatePublicationDetailsText(
  reviewCandidatePublication: ReviewCandidatePublicationRuntimeDetailsSummary,
): string | null {
  if (!isReviewCandidatePublicationMode(reviewCandidatePublication.mode)) return null;
  if (!Array.isArray(reviewCandidatePublication.reasons)) return null;

  const mode = reviewCandidatePublication.mode;
  const counts = sanitizedCandidatePublicationCounts(reviewCandidatePublication.counts);
  const reasons = formatReviewCandidatePublicationReasons(reviewCandidatePublication.reasons);
  const buckets = formatReviewCandidatePublicationOutcomeBuckets(reviewCandidatePublication.outcomeBuckets);

  return `Review candidate publication: mode=${mode} approved=${counts.approvedReferences} rewritten=${counts.rewrittenReferences} publishable=${counts.candidatePublishable} nonPublishable=${counts.nonPublishableReferences} fixBlocked=${counts.fixEligibilityBlocked} published=${counts.candidatePublished} directFallback=${counts.fallbackEvidence} reasons=${reasons} movedToDetails=${counts.candidateMovedToDetails} detailsOmitted=${counts.candidateDetailsOnlyOmitted}${buckets ? ` buckets=${buckets}` : ""}`;
}

function isReviewCandidatePublicationMode(value: string): value is ReviewCandidatePublicationRuntimeMode {
  return value === "candidate-approved"
    || value === "candidate-approved-partial"
    || value === "moved-to-details"
    || value === "direct-fallback"
    || value === "fallback-disallowed"
    || value === "blocked"
    || value === "degraded";
}

function sanitizedCandidatePublicationCounts(
  counts: ReviewCandidatePublicationRuntimeCounts,
): ReviewCandidatePublicationRuntimeCounts {
  return {
    approvedReferences: nonNegativeCount(counts.approvedReferences),
    rewrittenReferences: nonNegativeCount(counts.rewrittenReferences),
    candidatePublishable: nonNegativeCount(counts.candidatePublishable),
    candidatePublished: nonNegativeCount(counts.candidatePublished),
    candidateSkipped: nonNegativeCount(counts.candidateSkipped),
    candidateBlocked: nonNegativeCount(counts.candidateBlocked),
    candidateFailed: nonNegativeCount(counts.candidateFailed),
    candidateMalformed: nonNegativeCount(counts.candidateMalformed),
    candidateMovedToDetails: nonNegativeCount(counts.candidateMovedToDetails),
    candidateDetailsOnlyFindings: nonNegativeCount(counts.candidateDetailsOnlyFindings),
    candidateDetailsOnlyOmitted: nonNegativeCount(counts.candidateDetailsOnlyOmitted),
    fixEligibilityBlocked: nonNegativeCount(counts.fixEligibilityBlocked),
    nonPublishableReferences: nonNegativeCount(counts.nonPublishableReferences),
    convertedProcessedFindings: nonNegativeCount(counts.convertedProcessedFindings),
    directAttempted: nonNegativeCount(counts.directAttempted),
    directPublished: nonNegativeCount(counts.directPublished),
    fallbackEvidence: nonNegativeCount(counts.fallbackEvidence),
    fallbackDisallowed: nonNegativeCount(counts.fallbackDisallowed),
    malformed: nonNegativeCount(counts.malformed),
  };
}

function nonNegativeCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function formatReviewCandidatePublicationOutcomeBuckets(
  rawBuckets?: ReviewCandidatePublicationRuntimeOutcomeBuckets,
): string | null {
  if (!rawBuckets) return null;

  const entries: string[] = [];
  let omittedReasons = 0;
  const orderedKeys: ReadonlyArray<keyof ReviewCandidatePublicationRuntimeOutcomeBuckets> = [
    "published",
    "skipped",
    "blocked",
    "failed",
    "movedToDetails",
    "directFallback",
    "fallbackDisallowed",
    "degraded",
  ];
  for (const key of orderedKeys) {
    if (entries.length >= MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKETS) break;
    const bucket = rawBuckets[key];
    if (!bucket) continue;
    const formatted = formatReviewCandidatePublicationOutcomeBucket(bucket, key);
    if (!formatted) continue;
    entries.push(formatted.text);
    omittedReasons += formatted.omittedReasons;
  }

  if (entries.length === 0) return null;
  return `${entries.join(",")}${omittedReasons > 0 ? ` +${omittedReasons} bucketReasonsOmitted` : ""}`;
}

function formatReviewCandidatePublicationOutcomeBucket(
  bucket: ReviewCandidatePublicationRuntimeOutcomeBucket,
  key: string,
): { text: string; omittedReasons: number } | null {
  const count = nonNegativeCount(bucket.count);
  if (count <= 0) return null;

  const mode = sanitizeReviewCandidatePublicationBucketMode(bucket.mode, key);
  const safeReasons = bucket.reasons
    .map((reason) => sanitizeReviewCandidatePublicationToken(String(reason)))
    .filter(isSafeReviewCandidatePublicationBucketReason);
  const redactedReasons = mode === "degraded" ? 0 : bucket.reasons.length - safeReasons.length;
  const cappedReasons = safeReasons.slice(0, MAX_REVIEW_CANDIDATE_PUBLICATION_BUCKET_REASONS);
  const cappedOmissions = safeReasons.length - cappedReasons.length;

  return {
    text: `${mode}:${count}:${cappedReasons.length > 0 ? cappedReasons.join("+") : "unknown-safe-reason"}`,
    omittedReasons: Math.max(0, redactedReasons) + Math.max(0, cappedOmissions),
  };
}

function sanitizeReviewCandidatePublicationBucketMode(value: string, key: string): string {
  const mode = sanitizeReviewCandidatePublicationToken(value);
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
    const findings = reviewCandidatePublication.detailsOnlyFindings ?? [];
    if (findings.length === 0) return [];

    const rendered = findings
      .map(formatReviewCandidateMovedFindingLine)
      .filter((line): line is string => Boolean(line))
      .slice(0, MAX_REVIEW_CANDIDATE_DETAILS_ONLY_FINDINGS);
    if (rendered.length === 0) return [];

    const total = nonNegativeCount(reviewCandidatePublication.movedToDetails.counts.total);
    const explicitOmitted = nonNegativeCount(reviewCandidatePublication.movedToDetails.counts.omitted);
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

function hasSafeMovedToDetailsRedaction(
  summary: ReviewCandidatePublicationRuntimeDetailsSummary["movedToDetails"],
): summary is NonNullable<ReviewCandidatePublicationRuntimeDetailsSummary["movedToDetails"]> {
  if (!summary) return false;
  const redaction = summary.redaction;
  return redaction.rawCandidatePayloadsIncluded === false
    && redaction.rawPromptsIncluded === false
    && redaction.rawModelOutputIncluded === false
    && redaction.diffsIncluded === false
    && redaction.replacementTextIncluded === false
    && redaction.githubResponsePayloadsIncluded === false
    && redaction.secretLikeValuesIncluded === false
    && redaction.bounded === true;
}

function formatReviewCandidateMovedFindingLine(
  finding: NonNullable<ReviewCandidatePublicationRuntimeDetailsSummary["detailsOnlyFindings"]>[number],
): string | null {
  const title = sanitizeMovedDetailsText(finding.title, 96) ?? "Untitled finding";
  const severity = sanitizeReviewCandidatePublicationToken(finding.severity);
  const category = sanitizeReviewCandidatePublicationToken(finding.category);
  const path = sanitizeMovedDetailsPath(finding.location.path);
  const line = positiveInteger(finding.location.line);
  const reason = sanitizeReviewCandidatePublicationToken(finding.reason) || "unknown-safe-reason";
  if (!path || !line) return null;

  const excerpt = sanitizeMovedDetailsText(finding.excerpt, MAX_REVIEW_CANDIDATE_DETAILS_ONLY_EXCERPT_LENGTH);
  return `  - [${severity}/${category}] ${title} (${path}:${line}, reason=${reason})${excerpt ? ` — ${excerpt}` : ""}`;
}

function sanitizeMovedDetailsPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^b\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || /^[a-zA-Z]:[\\/]/.test(normalized)) return null;
  return sanitizeMovedDetailsText(normalized, 160);
}

function sanitizeMovedDetailsText(value: string | number | boolean | undefined, maxLength: number): string | null {
  if (value === undefined) return null;
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

function positiveInteger(value: number): number | null {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : null;
}

function formatMalformedReviewCandidatePublicationDetailsLine(): string {
  return "- Review candidate publication: mode=degraded approved=0 rewritten=0 publishable=0 nonPublishable=0 fixBlocked=0 published=0 directFallback=0 reasons=malformed-runtime-summary movedToDetails=0 detailsOmitted=0 buckets=degraded:1:malformed-runtime-summary";
}

function formatReviewCandidatePublicationReasons(values: readonly ReviewCandidatePublicationRuntimeReason[]): string {
  const reasons = values
    .map((reason) => sanitizeReviewCandidatePublicationReason(reason))
    .filter((reason) => reason.length > 0);

  if (reasons.length === 0) return "none";

  const cappedReasons = reasons.slice(0, MAX_REVIEW_CANDIDATE_PUBLICATION_REASONS);
  const remaining = reasons.length - cappedReasons.length;
  return remaining > 0 ? `${cappedReasons.join(",")} +${remaining} more` : cappedReasons.join(",");
}

function sanitizeReviewCandidatePublicationToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function sanitizeReviewCandidatePublicationReason(value: string): string {
  return sanitizeReviewCandidatePublicationToken(value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*[:=]\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/system prompt|hidden instructions/gi, "prompt-redacted"));
}
