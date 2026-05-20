import type { InlineReviewPublicationStatus } from "../execution/mcp/inline-review-publisher.ts";
import type { ReviewCandidateApprovalResult } from "./review-candidate-approval.ts";
import type {
  ReviewCandidateDetailsOnlyFinding,
  ReviewCandidateMovedToDetailsSummary,
  ReviewCandidatePublicationAdapterSummary,
  ReviewCandidatePublishedResultSummary,
} from "./review-candidate-publication-adapter.ts";

export type ReviewCandidatePublicationRuntimeMode =
  | "candidate-approved"
  | "candidate-approved-partial"
  | "moved-to-details"
  | "direct-fallback"
  | "fallback-disallowed"
  | "blocked"
  | "degraded";

export type ReviewCandidatePublicationRuntimeReason =
  | "candidate-publisher-published"
  | "candidate-publisher-partial"
  | "candidate-publisher-skipped"
  | "candidate-publisher-blocked"
  | "candidate-publisher-failed"
  | "candidate-publisher-malformed"
  | "candidate-publisher-missing"
  | "candidate-moved-to-details"
  | "malformed-moved-to-details"
  | "missing-shared-publisher-results"
  | "direct-fallback-attempted"
  | "direct-fallback-published"
  | "direct-fallback-disallowed"
  | "fallback-policy-blocked"
  | "no-candidate-publication-path"
  | "adapter-skipped-all"
  | "approval-blocked"
  | "malformed-approval-summary"
  | "malformed-adapter-summary"
  | "malformed-publisher-summary"
  | "malformed-publisher-result"
  | "unknown-publisher-status"
  | "missing-publisher-comment-id"
  | "converted-count-mismatch";

export type ReviewCandidatePublicationRuntimeCounts = {
  approvedReferences: number;
  rewrittenReferences: number;
  candidatePublishable: number;
  candidatePublished: number;
  candidateSkipped: number;
  candidateBlocked: number;
  candidateFailed: number;
  candidateMalformed: number;
  candidateMovedToDetails: number;
  candidateDetailsOnlyFindings: number;
  candidateDetailsOnlyOmitted: number;
  convertedProcessedFindings: number;
  directAttempted: number;
  directPublished: number;
  fallbackEvidence: number;
  fallbackDisallowed: number;
  malformed: number;
};

export type ReviewCandidatePublicationDirectEvidence = {
  attempted?: boolean;
  published?: number;
  allowed?: boolean;
  reason?: unknown;
};

export type ReviewCandidatePublicationRuntimeInput = {
  approval?: ReviewCandidateApprovalResult | null;
  adapter?: ReviewCandidatePublicationAdapterSummary | null;
  publisher?: ReviewCandidatePublishedResultSummary | null;
  convertedProcessedFindingCount?: unknown;
  directPublication?: ReviewCandidatePublicationDirectEvidence | null;
};

export type ReviewCandidatePublicationRuntimeDetailsSummary = {
  label: "Review candidate publication runtime";
  text: string;
  detailsOnlyFindings?: ReviewCandidateDetailsOnlyFinding[];
  movedToDetails?: ReviewCandidateMovedToDetailsSummary;
};

export type ReviewCandidatePublicationRuntimeConfigSnapshot = {
  mode: ReviewCandidatePublicationRuntimeMode;
  counts: ReviewCandidatePublicationRuntimeCounts;
  reasons: ReviewCandidatePublicationRuntimeReason[];
};

export type ReviewCandidatePublicationRuntimePublisherSample = {
  fingerprint: string;
  status: InlineReviewPublicationStatus | "missing" | "malformed" | "unknown";
  reason: string;
  hasCommentId: boolean;
};

export type ReviewCandidatePublicationRuntimeResult = {
  mode: ReviewCandidatePublicationRuntimeMode;
  counts: ReviewCandidatePublicationRuntimeCounts;
  reasons: ReviewCandidatePublicationRuntimeReason[];
  detailsSummary: ReviewCandidatePublicationRuntimeDetailsSummary;
  safeConfigSnapshot: ReviewCandidatePublicationRuntimeConfigSnapshot;
  publisherResultSample: ReviewCandidatePublicationRuntimePublisherSample[];
  detailsOnlyFindings: ReviewCandidateDetailsOnlyFinding[];
  movedToDetails?: ReviewCandidateMovedToDetailsSummary;
};

export type CandidatePublicationFlowEvidence = {
  payloadFingerprints: string[];
  publishedCommentIds: number[];
  convertedProcessedFindingCount: number;
  hasFabricatedProcessedFindings: false;
};

const MAX_REASON_CODES = 12;
const MAX_RESULT_SAMPLE = 20;
const MAX_SUMMARY_LENGTH = 320;
const MAX_TOKEN_LENGTH = 80;

const KNOWN_PUBLISHER_STATUSES = new Set(["published", "skipped", "blocked", "failed", "missing", "malformed"]);

export function classifyReviewCandidatePublicationRuntime(
  input: ReviewCandidatePublicationRuntimeInput,
): ReviewCandidatePublicationRuntimeResult {
  const reasons: ReviewCandidatePublicationRuntimeReason[] = [];
  const publisherResultSample: ReviewCandidatePublicationRuntimePublisherSample[] = [];

  const approvalCounts = normalizeApprovalCounts(input.approval, reasons);
  const adapterCounts = normalizeAdapterCounts(input.adapter, reasons);
  const direct = normalizeDirectEvidence(input.directPublication);
  const convertedProcessedFindings = normalizeCount(input.convertedProcessedFindingCount);
  let malformed = approvalCounts.malformed + adapterCounts.malformed;

  const publisher = normalizePublisherSummary(input.publisher, publisherResultSample, reasons);
  malformed += publisher.malformed;

  const approvedReferences = approvalCounts.approved + approvalCounts.rewritten;
  const candidatePublishable = adapterCounts.publishable;
  const candidatePublished = publisher.published;
  const movedToDetails = adapterCounts.movedToDetails + publisher.movedToDetails;
  const detailsOnlyFindings = adapterCounts.detailsOnlyFindings + publisher.detailsOnlyFindings;
  const detailsOnlyOmitted = adapterCounts.detailsOnlyOmitted + publisher.detailsOnlyOmitted;
  const detailsOnlyProjection = mergeDetailsOnlyFindings(input.adapter, input.publisher);
  if (detailsOnlyProjection.malformed > 0) {
    malformed += detailsOnlyProjection.malformed;
    pushReason(reasons, "malformed-moved-to-details");
  }
  const directPublished = direct.published;
  const fallbackDisallowed = approvalCounts.fallbackDisallowed > 0 || (direct.attempted && direct.allowed === false) ? 1 : 0;

  if (candidatePublished > 0) pushReason(reasons, "candidate-publisher-published");
  if (candidatePublished > 0 && candidatePublished < candidatePublishable) pushReason(reasons, "candidate-publisher-partial");
  if (publisher.skipped > 0) pushReason(reasons, "candidate-publisher-skipped");
  if (publisher.blocked > 0) pushReason(reasons, "candidate-publisher-blocked");
  if (publisher.failed > 0) pushReason(reasons, "candidate-publisher-failed");
  if (publisher.candidateMalformed > 0) pushReason(reasons, "candidate-publisher-malformed");
  if (publisher.missing > 0) pushReason(reasons, "candidate-publisher-missing");
  if (movedToDetails > 0) pushReason(reasons, "candidate-moved-to-details");

  if (direct.attempted) pushReason(reasons, "direct-fallback-attempted");
  if (directPublished > 0) pushReason(reasons, "direct-fallback-published");
  if (direct.attempted && direct.allowed === false) pushReason(reasons, "direct-fallback-disallowed");
  if (!input.publisher && candidatePublishable > 0) pushReason(reasons, "missing-shared-publisher-results");
  if (candidatePublishable === 0 && approvedReferences === 0) pushReason(reasons, "no-candidate-publication-path");
  if (adapterCounts.input > 0 && candidatePublishable === 0 && adapterCounts.skipped > 0) pushReason(reasons, "adapter-skipped-all");
  if (approvalCounts.approved === 0 && approvalCounts.rewritten === 0 && approvalCounts.suppressed + approvalCounts.rejected > 0) {
    pushReason(reasons, "approval-blocked");
  }
  if (candidatePublished !== convertedProcessedFindings && (candidatePublished > 0 || convertedProcessedFindings > 0)) {
    pushReason(reasons, "converted-count-mismatch");
    malformed += 1;
  }

  const counts: ReviewCandidatePublicationRuntimeCounts = {
    approvedReferences: approvalCounts.approved,
    rewrittenReferences: approvalCounts.rewritten,
    candidatePublishable,
    candidatePublished,
    candidateSkipped: publisher.skipped,
    candidateBlocked: publisher.blocked,
    candidateFailed: publisher.failed,
    candidateMalformed: publisher.candidateMalformed,
    candidateMovedToDetails: movedToDetails,
    candidateDetailsOnlyFindings: detailsOnlyFindings,
    candidateDetailsOnlyOmitted: detailsOnlyOmitted,
    convertedProcessedFindings,
    directAttempted: direct.attempted ? 1 : 0,
    directPublished,
    fallbackEvidence: candidatePublished > 0 ? 0 : directPublished,
    fallbackDisallowed,
    malformed,
  };

  const mode = classifyMode({ counts, reasons, directAttempted: direct.attempted, publisherPresent: Boolean(input.publisher) });
  const resultWithoutDerived = {
    mode,
    counts,
    reasons: reasons.slice(0, MAX_REASON_CODES),
    publisherResultSample,
    detailsOnlyFindings: detailsOnlyProjection.findings,
    ...(detailsOnlyProjection.summary ? { movedToDetails: detailsOnlyProjection.summary } : {}),
  };
  const detailsSummary = toReviewCandidatePublicationRuntimeDetailsSummary(resultWithoutDerived);
  const safeConfigSnapshot = toReviewCandidatePublicationRuntimeConfigSnapshot(resultWithoutDerived);

  return { ...resultWithoutDerived, detailsSummary, safeConfigSnapshot };
}

export function toReviewCandidatePublicationRuntimeDetailsSummary(result: Pick<ReviewCandidatePublicationRuntimeResult, "mode" | "counts" | "reasons"> & Partial<Pick<ReviewCandidatePublicationRuntimeResult, "detailsOnlyFindings" | "movedToDetails">>): ReviewCandidatePublicationRuntimeDetailsSummary {
  const counts = result.counts;
  const text = boundSummary([
    `Review candidate publication runtime: ${result.mode}`,
    `approvedRefs=${formatCount(counts.approvedReferences)}`,
    `rewrittenRefs=${formatCount(counts.rewrittenReferences)}`,
    `publishable=${formatCount(counts.candidatePublishable)}`,
    `candidatePublished=${formatCount(counts.candidatePublished)}`,
    `skipped=${formatCount(counts.candidateSkipped)}`,
    `blocked=${formatCount(counts.candidateBlocked)}`,
    `failed=${formatCount(counts.candidateFailed)}`,
    `movedToDetails=${formatCount(counts.candidateMovedToDetails)}`,
    `detailsOnly=${formatCount(counts.candidateDetailsOnlyFindings)}`,
    `detailsOmitted=${formatCount(counts.candidateDetailsOnlyOmitted)}`,
    `directPublished=${formatCount(counts.directPublished)}`,
    `fallbackEvidence=${formatCount(counts.fallbackEvidence)}`,
    `malformed=${formatCount(counts.malformed)}`,
    `reasons=${result.reasons.length > 0 ? result.reasons.map(sanitizeSummaryToken).join(",") : "none"}`,
  ].join(" "));

  return {
    label: "Review candidate publication runtime",
    text,
    ...(Array.isArray(result.detailsOnlyFindings) && result.detailsOnlyFindings.length > 0
      ? { detailsOnlyFindings: result.detailsOnlyFindings.slice(0, MAX_RESULT_SAMPLE) }
      : {}),
    ...(result.movedToDetails ? { movedToDetails: result.movedToDetails } : {}),
  };
}

export function toReviewCandidatePublicationRuntimeConfigSnapshot(
  result: Pick<ReviewCandidatePublicationRuntimeResult, "mode" | "counts" | "reasons">,
): ReviewCandidatePublicationRuntimeConfigSnapshot {
  return {
    mode: result.mode,
    counts: { ...result.counts },
    reasons: result.reasons.slice(0, MAX_REASON_CODES),
  };
}

export function createCandidatePublicationFlowEvidence(input: {
  payloadFingerprints: ReadonlyArray<unknown>;
  publisher?: ReviewCandidatePublishedResultSummary | null;
}): CandidatePublicationFlowEvidence {
  const payloadFingerprints = input.payloadFingerprints
    .map((value) => typeof value === "string" ? sanitizeSummaryToken(value) : "unknown")
    .slice(0, MAX_RESULT_SAMPLE);
  const publishedCommentIds = Array.isArray(input.publisher?.results)
    ? input.publisher.results
      .filter((result) => isRecord(result) && result.status === "published" && Number.isFinite(result.commentId))
      .map((result) => Math.floor(Number(result.commentId)))
      .slice(0, MAX_RESULT_SAMPLE)
    : [];

  return {
    payloadFingerprints,
    publishedCommentIds,
    convertedProcessedFindingCount: publishedCommentIds.length,
    hasFabricatedProcessedFindings: false,
  };
}

function classifyMode(input: {
  counts: ReviewCandidatePublicationRuntimeCounts;
  reasons: ReadonlyArray<ReviewCandidatePublicationRuntimeReason>;
  directAttempted: boolean;
  publisherPresent: boolean;
}): ReviewCandidatePublicationRuntimeMode {
  const { counts } = input;
  if (counts.malformed > 0 || input.reasons.some((reason) => reason.startsWith("malformed") || reason === "unknown-publisher-status" || reason === "converted-count-mismatch")) {
    return "degraded";
  }
  if (counts.fallbackDisallowed > 0 && counts.candidatePublished === 0 && counts.directPublished === 0) {
    return "fallback-disallowed";
  }
  if (counts.candidatePublished > 0 && counts.candidatePublished === counts.candidatePublishable) {
    return "candidate-approved";
  }
  if (counts.candidatePublished > 0) {
    return "candidate-approved-partial";
  }
  if (counts.candidateMovedToDetails > 0) {
    return "moved-to-details";
  }
  if (counts.directPublished > 0 || (input.directAttempted && !input.publisherPresent)) {
    return "direct-fallback";
  }
  return "blocked";
}

function normalizeApprovalCounts(
  approval: ReviewCandidateApprovalResult | null | undefined,
  reasons: ReviewCandidatePublicationRuntimeReason[],
): {
  approved: number;
  rewritten: number;
  suppressed: number;
  rejected: number;
  fallbackDisallowed: number;
  malformed: number;
} {
  const counts = approval?.counts;
  if (!isRecord(counts)) {
    pushReason(reasons, "malformed-approval-summary");
    return { approved: 0, rewritten: 0, suppressed: 0, rejected: 0, fallbackDisallowed: 0, malformed: 1 };
  }
  return {
    approved: normalizeCount(counts.approved),
    rewritten: normalizeCount(counts.rewritten),
    suppressed: normalizeCount(counts.suppressed),
    rejected: normalizeCount(counts.rejected),
    fallbackDisallowed: normalizeCount(counts.fallbackDisallowed),
    malformed: hasMalformedCount([counts.approved, counts.rewritten, counts.suppressed, counts.rejected, counts.fallbackDisallowed]) ? 1 : 0,
  };
}

function normalizeAdapterCounts(
  adapter: ReviewCandidatePublicationAdapterSummary | null | undefined,
  reasons: ReviewCandidatePublicationRuntimeReason[],
): {
  input: number;
  publishable: number;
  skipped: number;
  movedToDetails: number;
  detailsOnlyFindings: number;
  detailsOnlyOmitted: number;
  malformed: number;
} {
  const counts = adapter?.counts;
  if (!isRecord(counts)) {
    pushReason(reasons, "malformed-adapter-summary");
    return { input: 0, publishable: 0, skipped: 0, movedToDetails: 0, detailsOnlyFindings: 0, detailsOnlyOmitted: 0, malformed: 1 };
  }
  const skippedItems = Array.isArray(adapter?.skipped) ? adapter.skipped : [];
  const malformedSkipReasons = skippedItems.some((item) => !isRecord(item) || sanitizeSummaryToken(String(item.reason ?? "unknown")) === "unknown");
  if (malformedSkipReasons) pushReason(reasons, "malformed-adapter-summary");
  return {
    input: normalizeCount(counts.input),
    publishable: normalizeCount(counts.publishable),
    skipped: normalizeCount(counts.skipped),
    movedToDetails: normalizeCount(counts.movedToDetails),
    detailsOnlyFindings: normalizeCount(counts.detailsOnlyFindings),
    detailsOnlyOmitted: normalizeCount(counts.detailsOnlyOmitted),
    malformed: hasMalformedCount([counts.input, counts.publishable, counts.skipped]) || hasOptionalMalformedCount([counts.movedToDetails, counts.detailsOnlyFindings, counts.detailsOnlyOmitted]) || malformedSkipReasons ? 1 : 0,
  };
}

function normalizePublisherSummary(
  publisher: ReviewCandidatePublishedResultSummary | null | undefined,
  sample: ReviewCandidatePublicationRuntimePublisherSample[],
  reasons: ReviewCandidatePublicationRuntimeReason[],
): {
  published: number;
  skipped: number;
  blocked: number;
  failed: number;
  candidateMalformed: number;
  missing: number;
  movedToDetails: number;
  detailsOnlyFindings: number;
  detailsOnlyOmitted: number;
  malformed: number;
} {
  if (!publisher) {
    return { published: 0, skipped: 0, blocked: 0, failed: 0, candidateMalformed: 0, missing: 0, movedToDetails: 0, detailsOnlyFindings: 0, detailsOnlyOmitted: 0, malformed: 0 };
  }
  if (!Array.isArray(publisher.results)) {
    pushReason(reasons, "malformed-publisher-summary");
    return { published: 0, skipped: 0, blocked: 0, failed: 0, candidateMalformed: 0, missing: 0, movedToDetails: 0, detailsOnlyFindings: 0, detailsOnlyOmitted: 0, malformed: 1 };
  }

  let published = 0;
  let skipped = 0;
  let blocked = 0;
  let failed = 0;
  let candidateMalformed = 0;
  let missing = 0;
  let malformed = hasMalformedCount([
    publisher.counts?.input,
    publisher.counts?.processed,
    publisher.counts?.skipped,
    publisher.counts?.blocked,
    publisher.counts?.failed,
    publisher.counts?.malformed,
  ]) ? 1 : 0;
  if (hasOptionalMalformedCount([
    publisher.counts?.detailsOnlyFindings,
    publisher.counts?.movedToDetails,
    publisher.counts?.detailsOnlyOmitted,
  ])) {
    malformed += 1;
  }

  for (const raw of publisher.results) {
    if (!isRecord(raw)) {
      malformed += 1;
      pushReason(reasons, "malformed-publisher-result");
      if (sample.length < MAX_RESULT_SAMPLE) {
        sample.push({ fingerprint: "unknown", status: "malformed", reason: "malformed-publisher-result", hasCommentId: false });
      }
      continue;
    }

    const rawStatus = typeof raw.status === "string" ? raw.status : "malformed";
    const status = KNOWN_PUBLISHER_STATUSES.has(rawStatus) ? rawStatus : "unknown";
    const hasCommentId = Number.isFinite(raw.commentId);
    const reason = sanitizeSummaryToken(typeof raw.reason === "string" ? raw.reason : status);
    const fingerprint = sanitizeSummaryToken(typeof raw.fingerprint === "string" ? raw.fingerprint : "unknown");

    if (status === "published" && hasCommentId) {
      published += 1;
    } else if (status === "published") {
      candidateMalformed += 1;
      malformed += 1;
      pushReason(reasons, "missing-publisher-comment-id");
    } else if (status === "skipped") {
      skipped += 1;
    } else if (status === "blocked") {
      blocked += 1;
    } else if (status === "failed") {
      failed += 1;
    } else if (status === "missing") {
      missing += 1;
      skipped += 1;
    } else if (status === "malformed") {
      candidateMalformed += 1;
      malformed += 1;
      pushReason(reasons, "malformed-publisher-result");
    } else {
      malformed += 1;
      pushReason(reasons, "unknown-publisher-status");
    }

    if (sample.length < MAX_RESULT_SAMPLE) {
      sample.push({
        fingerprint,
        status: status as ReviewCandidatePublicationRuntimePublisherSample["status"],
        reason,
        hasCommentId,
      });
    }
  }

  return {
    published,
    skipped,
    blocked,
    failed,
    candidateMalformed,
    missing,
    movedToDetails: normalizeCount(publisher.counts?.movedToDetails),
    detailsOnlyFindings: normalizeCount(publisher.counts?.detailsOnlyFindings),
    detailsOnlyOmitted: normalizeCount(publisher.counts?.detailsOnlyOmitted),
    malformed,
  };
}

function mergeDetailsOnlyFindings(
  adapter: ReviewCandidatePublicationAdapterSummary | null | undefined,
  publisher: ReviewCandidatePublishedResultSummary | null | undefined,
): { findings: ReviewCandidateDetailsOnlyFinding[]; summary?: ReviewCandidateMovedToDetailsSummary; malformed: number } {
  const sources = [adapter, publisher];
  const findings: ReviewCandidateDetailsOnlyFinding[] = [];
  let malformed = 0;
  let total = 0;
  let fromFixEligibility = 0;
  let fromPublisherResult = 0;
  let omitted = 0;
  const reasonCounts: Partial<Record<ReviewCandidateMovedToDetailsSummary["reasonCounts"] extends Partial<Record<infer K, number>> ? K : never, number>> = {};

  for (const source of sources) {
    if (!source) continue;
    const summary = source.movedToDetails;
    const counts = source.counts;
    if (normalizeCount(counts.movedToDetails) > 0 && !isSafeMovedToDetailsSummary(summary)) {
      malformed += 1;
      continue;
    }
    total += normalizeCount(summary?.counts?.total ?? counts.movedToDetails);
    fromFixEligibility += normalizeCount(summary?.counts?.fromFixEligibility);
    fromPublisherResult += normalizeCount(summary?.counts?.fromPublisherResult);
    omitted += normalizeCount(summary?.counts?.omitted ?? counts.detailsOnlyOmitted);
    if (isRecord(summary?.reasonCounts)) {
      for (const [rawReason, rawCount] of Object.entries(summary.reasonCounts)) {
        const reason = sanitizeSummaryToken(rawReason);
        if (!reason || reason === "unknown") continue;
        reasonCounts[reason as keyof typeof reasonCounts] = (reasonCounts[reason as keyof typeof reasonCounts] ?? 0) + normalizeCount(rawCount);
      }
    }
    if ("detailsOnlyFindings" in source && Array.isArray(source.detailsOnlyFindings)) {
      for (const finding of source.detailsOnlyFindings) {
        if (findings.length >= MAX_RESULT_SAMPLE) {
          omitted += 1;
          continue;
        }
        findings.push(finding);
      }
    } else if (normalizeCount(counts.detailsOnlyFindings) > 0) {
      malformed += 1;
    }
  }

  const summary = total > 0 || findings.length > 0
    ? {
        counts: { total, fromFixEligibility, fromPublisherResult, omitted },
        reasonCounts,
        redaction: {
          rawCandidatePayloadsIncluded: false,
          rawPromptsIncluded: false,
          rawModelOutputIncluded: false,
          diffsIncluded: false,
          replacementTextIncluded: false,
          githubResponsePayloadsIncluded: false,
          secretLikeValuesIncluded: false,
          bounded: true,
        },
      } satisfies ReviewCandidateMovedToDetailsSummary
    : undefined;

  return { findings: malformed > 0 ? [] : findings, ...(summary ? { summary } : {}), malformed };
}

function isSafeMovedToDetailsSummary(summary: unknown): summary is ReviewCandidateMovedToDetailsSummary {
  if (!isRecord(summary) || !isRecord(summary.counts) || !isRecord(summary.redaction)) return false;
  return summary.redaction.rawCandidatePayloadsIncluded === false
    && summary.redaction.rawPromptsIncluded === false
    && summary.redaction.rawModelOutputIncluded === false
    && summary.redaction.diffsIncluded === false
    && summary.redaction.replacementTextIncluded === false
    && summary.redaction.githubResponsePayloadsIncluded === false
    && summary.redaction.secretLikeValuesIncluded === false
    && summary.redaction.bounded === true
    && !hasMalformedCount([
      summary.counts.total,
      summary.counts.fromFixEligibility,
      summary.counts.fromPublisherResult,
      summary.counts.omitted,
    ]);
}

function normalizeDirectEvidence(value: ReviewCandidatePublicationDirectEvidence | null | undefined): {
  attempted: boolean;
  published: number;
  allowed: boolean | undefined;
} {
  return {
    attempted: value?.attempted === true,
    published: normalizeCount(value?.published),
    allowed: typeof value?.allowed === "boolean" ? value.allowed : undefined,
  };
}

function pushReason(
  reasons: ReviewCandidatePublicationRuntimeReason[],
  reason: ReviewCandidatePublicationRuntimeReason,
): void {
  if (!reasons.includes(reason) && reasons.length < MAX_REASON_CODES) {
    reasons.push(reason);
  }
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function hasMalformedCount(values: ReadonlyArray<unknown>): boolean {
  return values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0);
}

function hasOptionalMalformedCount(values: ReadonlyArray<unknown>): boolean {
  return values.some((value) => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return Math.floor(value).toString();
}

function sanitizeSummaryToken(value: string): string {
  const normalized = value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET|BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/oversized\s+reason/gi, "reason")
    .replace(/[^a-zA-Z0-9._:,\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_TOKEN_LENGTH);

  return normalized || "unknown";
}

function boundSummary(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}
