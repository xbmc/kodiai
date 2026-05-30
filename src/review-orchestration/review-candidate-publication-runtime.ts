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
  | "fix-eligibility-blocked"
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
  fixEligibilityBlocked: number;
  nonPublishableReferences: number;
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

export type ReviewCandidatePublicationRuntimeOutcomeReason = ReviewCandidatePublicationRuntimeReason | string;

export type ReviewCandidatePublicationRuntimeOutcomeBucket = {
  mode: string;
  count: number;
  reasons: ReviewCandidatePublicationRuntimeOutcomeReason[];
};

export type ReviewCandidatePublicationRuntimeOutcomeBuckets = Partial<Record<
  | "published"
  | "skipped"
  | "blocked"
  | "failed"
  | "movedToDetails"
  | "directFallback"
  | "fallbackDisallowed"
  | "degraded",
  ReviewCandidatePublicationRuntimeOutcomeBucket
>>;

export type ReviewCandidatePublicationRuntimeDetailsSummary = {
  label: "Review candidate publication runtime";
  text: string;
  outcomeBuckets?: ReviewCandidatePublicationRuntimeOutcomeBuckets;
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
  outcomeBuckets: ReviewCandidatePublicationRuntimeOutcomeBuckets;
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
  const bucketReasons = createBucketReasonCollector();

  const approvalCounts = normalizeApprovalCounts(input.approval, reasons);
  const adapterCounts = normalizeAdapterCounts(input.adapter, reasons, bucketReasons);
  const direct = normalizeDirectEvidence(input.directPublication, bucketReasons);
  const convertedProcessedFindings = normalizeCount(input.convertedProcessedFindingCount);
  let malformed = approvalCounts.malformed + adapterCounts.malformed;

  const publisher = normalizePublisherSummary(input.publisher, publisherResultSample, reasons, bucketReasons);
  malformed += publisher.malformed;

  const approvedReferences = approvalCounts.approved + approvalCounts.rewritten;
  const candidatePublishable = adapterCounts.publishable;
  const fixEligibilityBlocked = adapterCounts.fixEligibilityBlocked;
  const candidatePublished = publisher.published;
  const candidateSkipped = publisher.skipped + adapterCounts.skipped;
  const movedToDetails = adapterCounts.movedToDetails + publisher.movedToDetails;
  const detailsOnlyFindings = adapterCounts.detailsOnlyFindings + publisher.detailsOnlyFindings;
  const detailsOnlyOmitted = adapterCounts.detailsOnlyOmitted + publisher.detailsOnlyOmitted;
  const detailsOnlyProjection = mergeDetailsOnlyFindings(input.adapter, input.publisher);
  if (detailsOnlyProjection.summary?.reasonCounts) {
    for (const [reason, count] of Object.entries(detailsOnlyProjection.summary.reasonCounts)) {
      if (normalizeCount(count) > 0) addBucketReason(bucketReasons.movedToDetails, reason, "candidate-moved-to-details");
    }
  }
  if (detailsOnlyProjection.malformed > 0) {
    malformed += detailsOnlyProjection.malformed;
    pushReason(reasons, "malformed-moved-to-details");
    addBucketReason(bucketReasons.degraded, undefined, "malformed-moved-to-details");
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
  if (fixEligibilityBlocked > 0) pushReason(reasons, "fix-eligibility-blocked");
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
    candidateSkipped,
    candidateBlocked: publisher.blocked,
    candidateFailed: publisher.failed,
    candidateMalformed: publisher.candidateMalformed,
    candidateMovedToDetails: movedToDetails,
    candidateDetailsOnlyFindings: detailsOnlyFindings,
    candidateDetailsOnlyOmitted: detailsOnlyOmitted,
    fixEligibilityBlocked,
    nonPublishableReferences: Math.max(0, approvedReferences - candidatePublishable),
    convertedProcessedFindings,
    directAttempted: direct.attempted ? 1 : 0,
    directPublished,
    fallbackEvidence: candidatePublished > 0 ? 0 : directPublished,
    fallbackDisallowed,
    malformed,
  };

  const mode = classifyMode({ counts, reasons, directAttempted: direct.attempted, publisherPresent: Boolean(input.publisher) });
  const boundedReasons = reasons.slice(0, MAX_REASON_CODES);
  const outcomeBuckets = createOutcomeBuckets(counts, boundedReasons, bucketReasons);
  const resultWithoutDerived = {
    mode,
    counts,
    reasons: boundedReasons,
    outcomeBuckets,
    publisherResultSample,
    detailsOnlyFindings: detailsOnlyProjection.findings,
    ...(detailsOnlyProjection.summary ? { movedToDetails: detailsOnlyProjection.summary } : {}),
  };
  const detailsSummary = toReviewCandidatePublicationRuntimeDetailsSummary(resultWithoutDerived);
  const safeConfigSnapshot = toReviewCandidatePublicationRuntimeConfigSnapshot(resultWithoutDerived);

  return { ...resultWithoutDerived, detailsSummary, safeConfigSnapshot };
}

export function toReviewCandidatePublicationRuntimeDetailsSummary(result: Pick<ReviewCandidatePublicationRuntimeResult, "mode" | "counts" | "reasons"> & Partial<Pick<ReviewCandidatePublicationRuntimeResult, "outcomeBuckets" | "detailsOnlyFindings" | "movedToDetails">>): ReviewCandidatePublicationRuntimeDetailsSummary {
  const counts = result.counts;
  const text = boundSummary([
    `Review candidate publication runtime: ${result.mode}`,
    `approvedRefs=${formatCount(counts.approvedReferences)}`,
    `rewrittenRefs=${formatCount(counts.rewrittenReferences)}`,
    `publishable=${formatCount(counts.candidatePublishable)}`,
    `nonPublishable=${formatCount(counts.nonPublishableReferences)}`,
    `fixBlocked=${formatCount(counts.fixEligibilityBlocked)}`,
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
    ...(result.outcomeBuckets ? { outcomeBuckets: result.outcomeBuckets } : {}),
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


function createOutcomeBuckets(
  counts: ReviewCandidatePublicationRuntimeCounts,
  reasons: ReadonlyArray<ReviewCandidatePublicationRuntimeReason>,
  bucketReasons: OutcomeBucketReasonCollector,
): ReviewCandidatePublicationRuntimeOutcomeBuckets {
  const buckets: ReviewCandidatePublicationRuntimeOutcomeBuckets = {};
  const blockedCount = counts.candidateBlocked > 0 || hasAnyReason(reasons, ["adapter-skipped-all", "approval-blocked", "no-candidate-publication-path", "fix-eligibility-blocked"])
    ? Math.max(1, counts.candidateBlocked, counts.fixEligibilityBlocked)
    : 0;

  addOutcomeBucket(buckets, "published", "published", counts.candidatePublished, reasons, ["candidate-publisher-published"], bucketReasons.published);
  addOutcomeBucket(buckets, "skipped", "skipped", counts.candidateSkipped, reasons, ["candidate-publisher-skipped", "candidate-publisher-missing", "malformed-adapter-summary"], bucketReasons.skipped);
  addOutcomeBucket(buckets, "blocked", "blocked", blockedCount, reasons, ["candidate-publisher-blocked", "adapter-skipped-all", "approval-blocked", "no-candidate-publication-path", "fix-eligibility-blocked"], bucketReasons.blocked);
  addOutcomeBucket(buckets, "failed", "failed", counts.candidateFailed, reasons, ["candidate-publisher-failed"], bucketReasons.failed);
  addOutcomeBucket(buckets, "movedToDetails", "moved-to-details", counts.candidateMovedToDetails, reasons, ["candidate-moved-to-details"], bucketReasons.movedToDetails);
  addOutcomeBucket(buckets, "directFallback", "direct-fallback", counts.fallbackEvidence, reasons, ["direct-fallback-attempted", "direct-fallback-published", "missing-shared-publisher-results"], bucketReasons.directFallback);
  addOutcomeBucket(buckets, "fallbackDisallowed", "fallback-disallowed", counts.fallbackDisallowed, reasons, ["direct-fallback-disallowed", "fallback-policy-blocked"], bucketReasons.fallbackDisallowed);
  addOutcomeBucket(buckets, "degraded", "degraded", counts.malformed, reasons, [
    "candidate-publisher-malformed",
    "malformed-moved-to-details",
    "malformed-approval-summary",
    "malformed-adapter-summary",
    "malformed-publisher-summary",
    "malformed-publisher-result",
    "unknown-publisher-status",
    "missing-publisher-comment-id",
    "converted-count-mismatch",
  ], bucketReasons.degraded);

  return buckets;
}

function hasAnyReason(
  reasons: ReadonlyArray<ReviewCandidatePublicationRuntimeReason>,
  candidates: ReadonlyArray<ReviewCandidatePublicationRuntimeReason>,
): boolean {
  return candidates.some((reason) => reasons.includes(reason));
}

function addOutcomeBucket(
  buckets: ReviewCandidatePublicationRuntimeOutcomeBuckets,
  key: keyof ReviewCandidatePublicationRuntimeOutcomeBuckets,
  mode: string,
  count: number,
  allReasons: ReadonlyArray<ReviewCandidatePublicationRuntimeReason>,
  candidates: ReadonlyArray<ReviewCandidatePublicationRuntimeReason>,
  derivedReasons: ReadonlyArray<string>,
): void {
  if (count <= 0) return;
  const canonicalReasons = candidates.filter((reason) => allReasons.includes(reason));
  const bucketReasons = dedupeBoundedReasons([...canonicalReasons, ...derivedReasons], 8);
  buckets[key] = {
    mode,
    count,
    reasons: bucketReasons.length > 0 ? bucketReasons : [candidates[0] ?? "no-candidate-publication-path"],
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

export function isExpectedCandidatePublicationPolicyBlock(runtime: Pick<ReviewCandidatePublicationRuntimeResult, "mode" | "counts" | "reasons" | "outcomeBuckets">): boolean {
  if (runtime.mode !== "blocked") return false;
  if (runtime.counts.candidateFailed !== 0) return false;
  if (runtime.counts.candidateMalformed !== 0) return false;
  if (runtime.counts.directPublished !== 0) return false;
  if (runtime.counts.malformed !== 0) return false;

  const publisherBlocked = runtime.counts.candidateBlocked > 0
    && runtime.reasons.every((reason) => reason === "candidate-publisher-blocked")
    && runtime.outcomeBuckets.blocked?.mode === "blocked"
    && (runtime.outcomeBuckets.blocked?.count ?? 0) > 0;

  const fixEligibilityBlocked = runtime.counts.fixEligibilityBlocked > 0
    && runtime.counts.candidatePublishable === 0
    && runtime.counts.candidatePublished === 0
    && runtime.reasons.every((reason) => reason === "fix-eligibility-blocked")
    && runtime.outcomeBuckets.blocked?.mode === "blocked"
    && (runtime.outcomeBuckets.blocked?.count ?? 0) === runtime.counts.fixEligibilityBlocked;

  const zeroCandidatePublicationPath = runtime.counts.approvedReferences === 0
    && runtime.counts.rewrittenReferences === 0
    && runtime.counts.candidatePublishable === 0
    && runtime.counts.candidatePublished === 0
    && runtime.counts.candidateBlocked === 0
    && runtime.reasons.includes("approval-blocked")
    && runtime.reasons.includes("no-candidate-publication-path")
    && runtime.reasons.every((reason) => reason === "approval-blocked" || reason === "no-candidate-publication-path")
    && runtime.outcomeBuckets.blocked?.mode === "blocked"
    && (runtime.outcomeBuckets.blocked?.count ?? 0) === 1;

  return publisherBlocked || fixEligibilityBlocked || zeroCandidatePublicationPath;
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
  bucketReasons: OutcomeBucketReasonCollector,
): {
  input: number;
  publishable: number;
  skipped: number;
  movedToDetails: number;
  detailsOnlyFindings: number;
  detailsOnlyOmitted: number;
  fixEligibilityBlocked: number;
  malformed: number;
} {
  const counts = adapter?.counts;
  if (!isRecord(counts)) {
    pushReason(reasons, "malformed-adapter-summary");
    return { input: 0, publishable: 0, skipped: 0, movedToDetails: 0, detailsOnlyFindings: 0, detailsOnlyOmitted: 0, fixEligibilityBlocked: 0, malformed: 1 };
  }
  const skippedItems = Array.isArray(adapter?.skipped) ? adapter.skipped : [];
  for (const item of skippedItems) {
    addBucketReason(bucketReasons.skipped, isRecord(item) ? item.reason : undefined, "adapter-skipped");
  }
  const malformedSkipReasons = skippedItems.some((item) => !isRecord(item) || sanitizeSummaryToken(String(item.reason ?? "unknown")) === "unknown");
  if (malformedSkipReasons) pushReason(reasons, "malformed-adapter-summary");
  const fixEligibilityBlocked = countBlockingFixEligibilityReasons(adapter?.fixEligibility?.reasonCounts);
  if (fixEligibilityBlocked > 0 && isRecord(adapter?.fixEligibility?.reasonCounts)) {
    for (const [reason, count] of Object.entries(adapter.fixEligibility.reasonCounts)) {
      const normalizedReason = sanitizeSummaryToken(reason);
      if (normalizedReason === "eligible" || normalizedReason === "line-not-commentable") continue;
      if (normalizeCount(count) > 0) addBucketReason(bucketReasons.blocked, reason, "fix-eligibility-blocked");
    }
  }
  return {
    input: normalizeCount(counts.input),
    publishable: normalizeCount(counts.publishable),
    skipped: normalizeCount(counts.skipped),
    movedToDetails: normalizeCount(counts.movedToDetails),
    detailsOnlyFindings: normalizeCount(counts.detailsOnlyFindings),
    detailsOnlyOmitted: normalizeCount(counts.detailsOnlyOmitted),
    fixEligibilityBlocked,
    malformed: hasMalformedCount([counts.input, counts.publishable, counts.skipped]) || hasOptionalMalformedCount([counts.movedToDetails, counts.detailsOnlyFindings, counts.detailsOnlyOmitted]) || malformedSkipReasons ? 1 : 0,
  };
}

function countBlockingFixEligibilityReasons(reasonCounts: unknown): number {
  if (!isRecord(reasonCounts)) return 0;
  let total = 0;
  for (const [reason, count] of Object.entries(reasonCounts)) {
    const normalizedReason = sanitizeSummaryToken(reason);
    if (normalizedReason === "eligible" || normalizedReason === "line-not-commentable") continue;
    total += normalizeCount(count);
  }
  return total;
}

function normalizePublisherSummary(
  publisher: ReviewCandidatePublishedResultSummary | null | undefined,
  sample: ReviewCandidatePublicationRuntimePublisherSample[],
  reasons: ReviewCandidatePublicationRuntimeReason[],
  bucketReasons: OutcomeBucketReasonCollector,
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
      addBucketReason(bucketReasons.degraded, undefined, "malformed-publisher-result");
      continue;
    }

    const rawStatus = typeof raw.status === "string" ? raw.status : "malformed";
    const status = KNOWN_PUBLISHER_STATUSES.has(rawStatus) ? rawStatus : "unknown";
    const hasCommentId = Number.isFinite(raw.commentId);
    const reason = sanitizeSummaryToken(typeof raw.reason === "string" ? raw.reason : status);
    const fingerprint = sanitizeSummaryToken(typeof raw.fingerprint === "string" ? raw.fingerprint : "unknown");

    if (status === "published" && hasCommentId) {
      published += 1;
      addBucketReason(bucketReasons.published, raw.reason, "published");
    } else if (status === "published") {
      candidateMalformed += 1;
      malformed += 1;
      pushReason(reasons, "missing-publisher-comment-id");
      addBucketReason(bucketReasons.degraded, raw.reason, "missing-comment-id");
    } else if (status === "skipped") {
      skipped += 1;
      addBucketReason(bucketReasons.skipped, raw.reason, "skipped");
    } else if (status === "blocked") {
      blocked += 1;
      addBucketReason(bucketReasons.blocked, raw.reason, "blocked");
    } else if (status === "failed") {
      failed += 1;
      addBucketReason(bucketReasons.failed, raw.reason, "failed");
    } else if (status === "missing") {
      missing += 1;
      skipped += 1;
      addBucketReason(bucketReasons.skipped, raw.reason, "missing-publisher-result");
    } else if (status === "malformed") {
      candidateMalformed += 1;
      malformed += 1;
      pushReason(reasons, "malformed-publisher-result");
      addBucketReason(bucketReasons.degraded, raw.reason, "malformed-publisher-result");
    } else {
      malformed += 1;
      pushReason(reasons, "unknown-publisher-status");
      addBucketReason(bucketReasons.degraded, raw.reason, "unknown-publisher-status");
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

function normalizeDirectEvidence(
  value: ReviewCandidatePublicationDirectEvidence | null | undefined,
  bucketReasons: OutcomeBucketReasonCollector,
): {
  attempted: boolean;
  published: number;
  allowed: boolean | undefined;
} {
  const attempted = value?.attempted === true;
  const published = normalizeCount(value?.published);
  const allowed = typeof value?.allowed === "boolean" ? value.allowed : undefined;
  if (published > 0) addBucketReason(bucketReasons.directFallback, value?.reason, "direct-fallback-published");
  if (attempted && allowed === false) addBucketReason(bucketReasons.fallbackDisallowed, value?.reason, "direct-fallback-disallowed");
  return { attempted, published, allowed };
}


type OutcomeBucketReasonCollector = Record<keyof ReviewCandidatePublicationRuntimeOutcomeBuckets, string[]>;

function createBucketReasonCollector(): OutcomeBucketReasonCollector {
  return {
    published: [],
    skipped: [],
    blocked: [],
    failed: [],
    movedToDetails: [],
    directFallback: [],
    fallbackDisallowed: [],
    degraded: [],
  };
}

function addBucketReason(target: string[], rawReason: unknown, fallback: string): void {
  const token = sanitizeOutcomeReasonToken(rawReason, fallback);
  if (!target.includes(token) && target.length < MAX_REASON_CODES) {
    target.push(token);
  }
}

function dedupeBoundedReasons(values: ReadonlyArray<string>, limit: number): string[] {
  const reasons: string[] = [];
  for (const value of values) {
    const token = sanitizeOutcomeReasonToken(value, "unknown-safe-reason");
    if (!reasons.includes(token)) reasons.push(token);
    if (reasons.length >= limit) break;
  }
  return reasons;
}

function sanitizeOutcomeReasonToken(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return sanitizeSummaryToken(fallback);
  const token = sanitizeSummaryToken(value);
  return token === "unknown" ? sanitizeSummaryToken(fallback) : token;
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
    .replace(/RAW[_-]?PROMPT[_-]?[A-Z0-9_-]*|PROMPT[_-]?SECRET|BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/unsafe\s+volume\s+reason/gi, "reason")
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
