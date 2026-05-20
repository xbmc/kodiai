import type {
  InlineCommentLocation,
  InlineReviewPublicationReason,
  InlineReviewPublicationResult,
  InlineReviewPublicationStatus,
  PublishInlineReviewCommentInput,
} from "../execution/mcp/inline-review-publisher.ts";
import {
  reduceSamePrFixEligibility,
  type SamePrFixEligibilityOutcome,
  type SamePrFixEligibilitySummary,
  type SamePrFixOwnedRange,
  type SamePrFixDraft,
} from "../review-lifecycle/same-pr-fix-eligibility.ts";
import type { SamePrFixTruthEvidence } from "../review-lifecycle/validation-truth.ts";
import type { FindingCategory, FindingSeverity } from "../lib/review-utils.ts";
import { sanitizeContent, scanOutgoingForSecrets } from "../lib/sanitizer.ts";
import type {
  ReviewCandidateApprovalCandidateReference,
  ReviewCandidateApprovalReason,
  ReviewCandidateApprovalResult,
} from "./review-candidate-approval.ts";
import type { ReviewCandidateFinding } from "./review-candidate-finding.ts";
import type { ProcessedReviewFinding, ReviewReducerResult } from "./review-reducer.ts";

export type ReviewCandidatePublicationLifecycle = "approved" | "rewritten";

export type ReviewCandidatePublicationSkipReason =
  | "candidate-empty"
  | "missing-candidate"
  | "missing-path"
  | "unsafe-path"
  | "missing-line"
  | "invalid-line-range"
  | "missing-rewrite-visible-finding";

export type ReviewCandidateMovedToDetailsReason =
  | "line-not-commentable"
  | "line-not-commentable-in-pr-diff";

export type ReviewCandidatePublisherResultReason =
  | "published"
  | "missing-publisher-result"
  | "missing-comment-id"
  | "failed"
  | "skipped"
  | "blocked"
  | InlineReviewPublicationReason;

type ProcessedReviewFindingDraft = Omit<ProcessedReviewFinding, "commentId"> &
  Pick<ProcessedReviewFinding, "filePath" | "title" | "severity" | "category">;

export type PublishableReviewCandidateInlinePayload = {
  candidateFingerprint: string;
  candidatePublicationLifecycle: ReviewCandidatePublicationLifecycle;
  sourceReason?: ReviewCandidateApprovalReason;
  source: "candidate" | "reducer-visible-finding";
  publication: PublishInlineReviewCommentInput;
  finding: ProcessedReviewFindingDraft;
};

export type ReviewCandidateDetailsOnlyFinding = {
  fingerprint: string;
  lifecycle: ReviewCandidatePublicationLifecycle;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  location: {
    path: string;
    startLine?: number;
    line: number;
  };
  reason: ReviewCandidateMovedToDetailsReason;
  excerpt?: string;
};

export type ReviewCandidateMovedToDetailsSummary = {
  counts: {
    total: number;
    fromFixEligibility: number;
    fromPublisherResult: number;
    omitted: number;
  };
  reasonCounts: Partial<Record<ReviewCandidateMovedToDetailsReason, number>>;
  redaction: {
    rawCandidatePayloadsIncluded: false;
    rawPromptsIncluded: false;
    rawModelOutputIncluded: false;
    diffsIncluded: false;
    replacementTextIncluded: false;
    githubResponsePayloadsIncluded: false;
    secretLikeValuesIncluded: false;
    bounded: true;
  };
};

export type ReviewCandidatePublicationAdapterSkipped = {
  fingerprint: string;
  lifecycle: ReviewCandidatePublicationLifecycle;
  reason: ReviewCandidatePublicationSkipReason;
  sourceReason?: ReviewCandidateApprovalReason;
  filePath?: string;
  startLine?: number;
  endLine?: number;
};

export type ReviewCandidatePublicationFixEligibilityOutcome = SamePrFixEligibilityOutcome & {
  fingerprint: string;
  lifecycle: ReviewCandidatePublicationLifecycle;
};

export type ReviewCandidatePublicationAdapterSummary = {
  counts: {
    input: number;
    publishable: number;
    skipped: number;
    approved: number;
    rewritten: number;
    detailsOnlyFindings: number;
    movedToDetails: number;
    detailsOnlyOmitted: number;
  };
  skipped: ReviewCandidatePublicationAdapterSkipped[];
  fingerprints: string[];
  fixEligibility: SamePrFixEligibilitySummary;
  fixOutcomes: ReviewCandidatePublicationFixEligibilityOutcome[];
  detailsOnlyFindings: ReviewCandidateDetailsOnlyFinding[];
  movedToDetails: ReviewCandidateMovedToDetailsSummary;
};

export type ReviewCandidatePublicationAdapterDetailsSummary = {
  label: "Review candidate publication adapter";
  text: string;
};

export type ReviewCandidatePublicationAdapterResult = {
  payloads: PublishableReviewCandidateInlinePayload[];
  summary: ReviewCandidatePublicationAdapterSummary;
};

export type ReviewCandidatePublishedResultSummary = {
  counts: {
    input: number;
    processed: number;
    skipped: number;
    blocked: number;
    failed: number;
    malformed: number;
    detailsOnlyFindings: number;
    movedToDetails: number;
    detailsOnlyOmitted: number;
  };
  results: Array<{
    fingerprint: string;
    status: InlineReviewPublicationStatus | "missing" | "malformed";
    reason: ReviewCandidatePublisherResultReason;
    commentId?: number;
  }>;
  movedToDetails: ReviewCandidateMovedToDetailsSummary;
};

export type ReviewCandidatePublishedFindingResult = {
  findings: ProcessedReviewFinding[];
  detailsOnlyFindings: ReviewCandidateDetailsOnlyFinding[];
  summary: ReviewCandidatePublishedResultSummary;
};

export type ReviewCandidatePublicationTruthEvidence = SamePrFixTruthEvidence & {
  candidateFingerprint: string;
  publicationStatus: InlineReviewPublicationStatus | "missing" | "malformed";
  publicationReason: ReviewCandidatePublisherResultReason;
  commentArtifactRef?: string;
  redaction: {
    privateOnly: true;
    rawPublicationPayloadIncluded: false;
    candidateBodyIncluded: false;
    replacementTextIncluded: false;
  };
};

const MAX_SUMMARY_LENGTH = 280;
const MAX_SUMMARY_ITEMS = 20;
const MAX_DETAILS_ONLY_FINDINGS = 20;
const MAX_DETAILS_ONLY_TITLE_LENGTH = 120;
const MAX_DETAILS_ONLY_EXCERPT_LENGTH = 240;

export function buildCandidateReviewOutputKey(reviewOutputKey: string, candidateFingerprint: string): string {
  const baseKey = typeof reviewOutputKey === "string" ? reviewOutputKey.trim() : "";
  const fingerprint = sanitizeSummaryToken(candidateFingerprint);
  return `${baseKey}:candidate:${fingerprint}`;
}

export function adaptApprovedCandidatesForInlinePublication(input: {
  approval: ReviewCandidateApprovalResult;
  reducer: Pick<ReviewReducerResult, "visibleFindings">;
  prDiffText?: string | null;
  formatterOwnedRanges?: ReadonlyArray<SamePrFixOwnedRange | null | undefined> | null;
  maxFixSuggestions?: number;
  seenFixIdentities?: Iterable<string> | null;
  logger?: {
    warn: (obj: unknown, msg: string) => void;
  };
}): ReviewCandidatePublicationAdapterResult {
  const visibleByFingerprint = buildVisibleFindingJoin(input.reducer.visibleFindings);
  const candidates = [
    ...input.approval.approvedCandidates,
    ...input.approval.rewrittenCandidates,
  ];
  const eligibleInputs: Array<{
    reference: ReviewCandidateApprovalCandidateReference;
    candidate: ReviewCandidateFinding;
    joinedFinding?: ProcessedReviewFinding;
    finding: ProcessedReviewFindingDraft;
  }> = [];
  const skipped: ReviewCandidatePublicationAdapterSkipped[] = [];

  for (const reference of candidates) {
    const candidate = reference.candidate;
    if (!isCandidateFinding(candidate)) {
      skipped.push(skip(reference.fingerprint, reference.lifecycle, "missing-candidate", { sourceReason: reference.reason }));
      continue;
    }

    const location = toInlineCommentLocation(candidate);
    if ("reason" in location) {
      skipped.push(skip(reference.fingerprint, reference.lifecycle, location.reason, {
        sourceReason: reference.reason,
        filePath: candidate.filePath,
        ...(typeof candidate.startLine === "number" ? { startLine: candidate.startLine } : {}),
        ...(typeof candidate.endLine === "number" ? { endLine: candidate.endLine } : {}),
      }));
      continue;
    }

    const joinedFinding = visibleByFingerprint.get(reference.fingerprint);
    if (reference.lifecycle === "rewritten" && !joinedFinding) {
      const skippedRewrite = skip(reference.fingerprint, reference.lifecycle, "missing-rewrite-visible-finding", {
        sourceReason: reference.reason,
        filePath: candidate.filePath,
        ...(typeof candidate.startLine === "number" ? { startLine: candidate.startLine } : {}),
        ...(typeof candidate.endLine === "number" ? { endLine: candidate.endLine } : {}),
      });
      skipped.push(skippedRewrite);
      input.logger?.warn(
        {
          fingerprint: skippedRewrite.fingerprint,
          lifecycle: skippedRewrite.lifecycle,
          reason: skippedRewrite.reason,
          sourceReason: skippedRewrite.sourceReason,
          filePath: skippedRewrite.filePath,
          startLine: skippedRewrite.startLine,
          endLine: skippedRewrite.endLine,
        },
        "Rewritten review candidate missing visible reducer finding",
      );
      continue;
    }

    const sourceFinding = joinedFinding ?? candidate;
    eligibleInputs.push({
      reference,
      candidate,
      ...(joinedFinding ? { joinedFinding } : {}),
      finding: toProcessedFindingDraft(sourceFinding, candidate, reference),
    });
  }

  const fixEligibility = reduceSamePrFixEligibility({
    reviewOutputKey: eligibleInputs[0]?.candidate.reviewOutputKey,
    deliveryId: eligibleInputs[0]?.candidate.deliveryId,
    prDiffText: input.prDiffText ?? "",
    formatterOwnedRanges: input.formatterOwnedRanges,
    maxSuggestions: input.maxFixSuggestions ?? Number.POSITIVE_INFINITY,
    seenIdentities: input.seenFixIdentities,
    candidates: eligibleInputs.map(({ reference, candidate, joinedFinding }) => ({
      filePath: candidate.filePath,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      title: joinedFinding?.title ?? candidate.title,
      severity: joinedFinding?.severity ?? candidate.severity,
      category: joinedFinding?.category ?? candidate.category,
      replacementText: extractFixReplacementText(joinedFinding) ?? candidate.fixReplacementText,
      candidateApproved: reference.reason === "candidate-rejected" ? false : true,
      reducerApproved: isReducerDeniedReason(reference.reason) ? false : true,
      findingIdentity: reference.fingerprint,
      candidateFingerprint: reference.fingerprint,
      reducerFingerprint: typeof joinedFinding?.candidateFingerprint === "string" ? joinedFinding.candidateFingerprint : undefined,
      lifecycleId: reference.lifecycle,
      rawCandidateBody: candidate.body,
    })),
  });
  const draftsByIdentity = new Map<string, SamePrFixDraft>(fixEligibility.drafts.map((draft) => [draft.identity, draft]));
  const payloads: PublishableReviewCandidateInlinePayload[] = [];
  const detailsProjection = createDetailsOnlyProjection();

  fixEligibility.outcomes.forEach((outcome, index) => {
    const eligibleInput = eligibleInputs[index];
    if (outcome.reason === "line-not-commentable" && eligibleInput) {
      detailsProjection.add(fromEligibleInputDetailsFinding(eligibleInput, outcome, "line-not-commentable"), "fromFixEligibility");
      return;
    }
    if (outcome.reason !== "eligible") return;
    const draft = draftsByIdentity.get(outcome.identity);
    if (!draft || !eligibleInput) return;
    payloads.push({
      candidateFingerprint: eligibleInput.reference.fingerprint,
      candidatePublicationLifecycle: eligibleInput.reference.lifecycle,
      ...(eligibleInput.reference.reason ? { sourceReason: eligibleInput.reference.reason } : {}),
      source: eligibleInput.joinedFinding ? "reducer-visible-finding" : "candidate",
      publication: { location: toDraftInlineCommentLocation(draft), body: draft.body },
      finding: eligibleInput.finding,
    });
  });

  const fixOutcomes: ReviewCandidatePublicationFixEligibilityOutcome[] = fixEligibility.outcomes.map((outcome, index) => ({
    ...outcome,
    fingerprint: sanitizeSummaryToken(eligibleInputs[index]?.reference.fingerprint ?? outcome.identity),
    lifecycle: eligibleInputs[index]?.reference.lifecycle ?? "approved",
  }));

  const summary: ReviewCandidatePublicationAdapterSummary = {
    counts: {
      input: candidates.length,
      publishable: payloads.length,
      skipped: skipped.length,
      approved: payloads.filter((payload) => payload.candidatePublicationLifecycle === "approved").length,
      rewritten: payloads.filter((payload) => payload.candidatePublicationLifecycle === "rewritten").length,
      detailsOnlyFindings: detailsProjection.findings.length,
      movedToDetails: detailsProjection.summary.counts.total,
      detailsOnlyOmitted: detailsProjection.summary.counts.omitted,
    },
    skipped,
    fingerprints: payloads.map((payload) => payload.candidateFingerprint).slice(0, MAX_SUMMARY_ITEMS),
    fixEligibility: fixEligibility.summary,
    fixOutcomes,
    detailsOnlyFindings: detailsProjection.findings,
    movedToDetails: detailsProjection.summary,
  };

  return { payloads, summary };
}

export function convertPublishedCandidateResultsToProcessedFindings(input: {
  payloads: ReadonlyArray<PublishableReviewCandidateInlinePayload>;
  results: ReadonlyMap<string, InlineReviewPublicationResult>;
}): ReviewCandidatePublishedFindingResult {
  const findings: ProcessedReviewFinding[] = [];
  const detailsProjection = createDetailsOnlyProjection();
  const results: ReviewCandidatePublishedResultSummary["results"] = [];

  for (const payload of input.payloads) {
    const result = input.results.get(payload.candidateFingerprint);
    if (!result) {
      results.push({
        fingerprint: payload.candidateFingerprint,
        status: "missing",
        reason: "missing-publisher-result",
      });
      continue;
    }

    if (result.status !== "published") {
      const reason = result.reason ?? result.status;
      results.push({
        fingerprint: payload.candidateFingerprint,
        status: result.status,
        reason,
      });
      if (result.status === "failed" && result.reason === "line-not-commentable-in-pr-diff") {
        detailsProjection.add(fromPayloadDetailsFinding(payload, "line-not-commentable-in-pr-diff"), "fromPublisherResult");
      }
      continue;
    }

    if (!Number.isFinite(result.commentId)) {
      results.push({
        fingerprint: payload.candidateFingerprint,
        status: "malformed",
        reason: "missing-comment-id",
      });
      continue;
    }

    const commentId = Math.floor(result.commentId!);
    findings.push({
      ...payload.finding,
      commentId,
      candidateFingerprint: payload.candidateFingerprint,
      candidatePublicationLifecycle: payload.candidatePublicationLifecycle,
      publicationStatus: "published",
    });
    results.push({
      fingerprint: payload.candidateFingerprint,
      status: "published",
      reason: "published",
      commentId,
    });
  }

  return {
    findings,
    detailsOnlyFindings: detailsProjection.findings,
    summary: {
      counts: {
        input: input.payloads.length,
        processed: findings.length,
        skipped: results.filter((result) => result.status === "skipped" || result.status === "missing").length,
        blocked: results.filter((result) => result.status === "blocked").length,
        failed: results.filter((result) => result.status === "failed").length,
        malformed: results.filter((result) => result.status === "malformed").length,
        detailsOnlyFindings: detailsProjection.findings.length,
        movedToDetails: detailsProjection.summary.counts.total,
        detailsOnlyOmitted: detailsProjection.summary.counts.omitted,
      },
      results,
      movedToDetails: detailsProjection.summary,
    },
  };
}

export function convertPublishedCandidateResultsToValidationTruthFixes(input: {
  payloads: ReadonlyArray<PublishableReviewCandidateInlinePayload>;
  results: ReadonlyMap<string, InlineReviewPublicationResult>;
  reviewOutputKey?: string | null;
  deliveryId?: string | null;
}): ReviewCandidatePublicationTruthEvidence[] {
  return input.payloads.map((payload) => {
    const result = input.results.get(payload.candidateFingerprint);
    const normalized = normalizePublicationTruthResult(result);
    const commentId = normalized.commentId;
    return {
      reviewOutputKey: input.reviewOutputKey,
      deliveryId: input.deliveryId,
      candidateFingerprint: sanitizeSummaryToken(payload.candidateFingerprint),
      findingIdentityHash: sanitizeSummaryToken(payload.candidateFingerprint),
      status: normalized.truthStatus,
      suggested: normalized.truthStatus === "suggested",
      publicationStatus: normalized.publicationStatus,
      publicationReason: normalized.reason,
      ...(typeof commentId === "number" ? { commentArtifactRef: `comment:${commentId}` } : {}),
      redaction: {
        privateOnly: true,
        rawPublicationPayloadIncluded: false,
        candidateBodyIncluded: false,
        replacementTextIncluded: false,
      },
    };
  });
}

export function toReviewCandidatePublicationAdapterSummary(
  summary: ReviewCandidatePublicationAdapterSummary,
): ReviewCandidatePublicationAdapterDetailsSummary {
  const reasons = Array.from(new Set(summary.skipped.map((item) => item.reason))).slice(0, MAX_SUMMARY_ITEMS);
  const fixReasons = Object.keys(summary.fixEligibility.reasonCounts).slice(0, MAX_SUMMARY_ITEMS);
  const fingerprints = summary.fingerprints.slice(0, MAX_SUMMARY_ITEMS).map(sanitizeSummaryToken);
  const text = boundSummary([
    "Review candidate publication adapter:",
    `input=${formatCount(summary.counts.input)}`,
    `publishable=${formatCount(summary.counts.publishable)}`,
    `skipped=${formatCount(summary.counts.skipped)}`,
    `approved=${formatCount(summary.counts.approved)}`,
    `rewritten=${formatCount(summary.counts.rewritten)}`,
    `detailsOnly=${formatCount(summary.counts.detailsOnlyFindings)}`,
    `movedToDetails=${formatCount(summary.counts.movedToDetails)}`,
    `detailsOmitted=${formatCount(summary.counts.detailsOnlyOmitted)}`,
    `fixEligible=${formatCount(summary.fixEligibility.counts.eligible)}`,
    `fixBlocked=${formatCount(summary.fixEligibility.counts.blocked)}`,
    `fixCapped=${formatCount(summary.fixEligibility.counts.capped)}`,
    `reasons=${reasons.length > 0 ? reasons.map(sanitizeSummaryToken).join(",") : "none"}`,
    `fixReasons=${fixReasons.length > 0 ? fixReasons.map(sanitizeSummaryToken).join(",") : "none"}`,
    `fingerprints=${fingerprints.length > 0 ? fingerprints.join(",") : "none"}`,
  ].join(" "));

  return { label: "Review candidate publication adapter", text };
}

export function formatReviewCandidateInlineBody(
  finding: Pick<ProcessedReviewFinding, "severity" | "category" | "title"> & { body?: unknown },
): string {
  const severity = normalizeSeverity(finding.severity);
  const category = normalizeCategory(finding.category);
  const title = normalizeText(finding.title, "Untitled finding");
  const body = typeof finding.body === "string" && finding.body.trim().length > 0
    ? finding.body.trim()
    : title;

  return [
    "```yaml",
    `severity: ${severity}`,
    `category: ${category}`,
    "```",
    "",
    `**${title}**`,
    "",
    body,
  ].join("\n");
}

function createDetailsOnlyProjection(): {
  findings: ReviewCandidateDetailsOnlyFinding[];
  summary: ReviewCandidateMovedToDetailsSummary;
  add: (finding: ReviewCandidateDetailsOnlyFinding | undefined, source: "fromFixEligibility" | "fromPublisherResult") => void;
} {
  const findings: ReviewCandidateDetailsOnlyFinding[] = [];
  const reasonCounts: Partial<Record<ReviewCandidateMovedToDetailsReason, number>> = {};
  let omitted = 0;
  let fromFixEligibility = 0;
  let fromPublisherResult = 0;

  const summary: ReviewCandidateMovedToDetailsSummary = {
    counts: { total: 0, fromFixEligibility: 0, fromPublisherResult: 0, omitted: 0 },
    reasonCounts,
    redaction: detailsOnlyRedaction(),
  };

  return {
    findings,
    summary,
    add(finding, source) {
      if (!finding) return;
      summary.counts.total += 1;
      if (source === "fromFixEligibility") {
        fromFixEligibility += 1;
        summary.counts.fromFixEligibility = fromFixEligibility;
      } else {
        fromPublisherResult += 1;
        summary.counts.fromPublisherResult = fromPublisherResult;
      }
      reasonCounts[finding.reason] = (reasonCounts[finding.reason] ?? 0) + 1;
      if (findings.length >= MAX_DETAILS_ONLY_FINDINGS) {
        omitted += 1;
        summary.counts.omitted = omitted;
        return;
      }
      findings.push(finding);
    },
  };
}

function fromEligibleInputDetailsFinding(
  input: { reference: ReviewCandidateApprovalCandidateReference; candidate: ReviewCandidateFinding; finding: ProcessedReviewFindingDraft },
  outcome: SamePrFixEligibilityOutcome,
  reason: ReviewCandidateMovedToDetailsReason,
): ReviewCandidateDetailsOnlyFinding | undefined {
  return toDetailsOnlyFinding({
    fingerprint: input.reference.fingerprint,
    lifecycle: input.reference.lifecycle,
    severity: input.finding.severity,
    category: input.finding.category,
    title: input.finding.title,
    body: input.finding.body,
    filePath: outcome.path ?? input.candidate.filePath,
    startLine: outcome.startLine ?? input.candidate.startLine,
    line: outcome.line ?? input.candidate.endLine ?? input.candidate.startLine,
    reason,
  });
}

function fromPayloadDetailsFinding(
  payload: PublishableReviewCandidateInlinePayload,
  reason: ReviewCandidateMovedToDetailsReason,
): ReviewCandidateDetailsOnlyFinding | undefined {
  return toDetailsOnlyFinding({
    fingerprint: payload.candidateFingerprint,
    lifecycle: payload.candidatePublicationLifecycle,
    severity: payload.finding.severity,
    category: payload.finding.category,
    title: payload.finding.title,
    body: payload.finding.body,
    filePath: payload.publication.location.path,
    startLine: payload.publication.location.startLine ?? payload.finding.startLine,
    line: payload.publication.location.line ?? payload.finding.endLine ?? payload.finding.startLine,
    reason,
  });
}

function toDetailsOnlyFinding(input: {
  fingerprint: string;
  lifecycle: ReviewCandidatePublicationLifecycle;
  severity: FindingSeverity;
  category: FindingCategory;
  title: unknown;
  body?: unknown;
  filePath?: unknown;
  startLine?: unknown;
  line?: unknown;
  reason: ReviewCandidateMovedToDetailsReason;
}): ReviewCandidateDetailsOnlyFinding | undefined {
  const path = normalizeDetailsPath(input.filePath);
  const line = normalizePositiveInteger(input.line);
  const startLine = normalizePositiveInteger(input.startLine ?? input.line);
  if (!path || !line || !startLine || startLine > line) return undefined;
  const title = sanitizePublicText(input.title, "Untitled finding", MAX_DETAILS_ONLY_TITLE_LENGTH);
  const excerpt = sanitizeOptionalExcerpt(input.body);
  return {
    fingerprint: sanitizeSummaryToken(input.fingerprint),
    lifecycle: input.lifecycle,
    severity: normalizeSeverity(input.severity),
    category: normalizeCategory(input.category),
    title,
    location: {
      path,
      ...(startLine === line ? {} : { startLine }),
      line,
    },
    reason: input.reason,
    ...(excerpt ? { excerpt } : {}),
  };
}

function normalizeDetailsPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^b\//, "").slice(0, 512);
  if (!normalized || isUnsafeFilePath(normalized)) return undefined;
  return normalized;
}

function sanitizeOptionalExcerpt(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const sanitized = sanitizePublicText(value, "", MAX_DETAILS_ONLY_EXCERPT_LENGTH);
  return sanitized || undefined;
}

function sanitizePublicText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = sanitizeContent(value)
    .replace(/```suggestion[\s\S]*?```/gi, "[fix-redacted]")
    .replace(/diff --git[\s\S]*/gi, "diff-redacted")
    .replace(/BEGIN\s+PROMPT[\s\S]*/gi, "prompt-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/TOKEN\s*[:=]\s*[^\s]+/gi, "token-redacted")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret-redacted")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "redacted")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  if (scanOutgoingForSecrets(normalized).blocked) return "[redacted]";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function detailsOnlyRedaction(): ReviewCandidateMovedToDetailsSummary["redaction"] {
  return {
    rawCandidatePayloadsIncluded: false,
    rawPromptsIncluded: false,
    rawModelOutputIncluded: false,
    diffsIncluded: false,
    replacementTextIncluded: false,
    githubResponsePayloadsIncluded: false,
    secretLikeValuesIncluded: false,
    bounded: true,
  };
}

function normalizePublicationTruthResult(result: InlineReviewPublicationResult | undefined): {
  truthStatus: NonNullable<SamePrFixTruthEvidence["status"]>;
  publicationStatus: ReviewCandidatePublicationTruthEvidence["publicationStatus"];
  reason: ReviewCandidatePublisherResultReason;
  commentId?: number;
} {
  if (!result) {
    return { truthStatus: "degraded", publicationStatus: "missing", reason: "missing-publisher-result" };
  }
  if (result.status === "published") {
    if (!Number.isFinite(result.commentId)) {
      return { truthStatus: "degraded", publicationStatus: "malformed", reason: "missing-comment-id" };
    }
    return {
      truthStatus: "suggested",
      publicationStatus: "published",
      reason: "published",
      commentId: Math.floor(result.commentId!),
    };
  }
  if (result.status === "skipped" && result.reason === "already-published") {
    return { truthStatus: "suggested", publicationStatus: "skipped", reason: "already-published" };
  }
  if (result.status === "blocked") {
    return { truthStatus: "blocked", publicationStatus: "blocked", reason: result.reason ?? "blocked" };
  }
  if (result.status === "skipped") {
    return { truthStatus: "blocked", publicationStatus: "skipped", reason: result.reason ?? "skipped" };
  }
  return { truthStatus: "degraded", publicationStatus: "failed", reason: result.reason ?? "failed" };
}

function toDraftInlineCommentLocation(draft: SamePrFixDraft): InlineCommentLocation {
  return {
    path: draft.path,
    ...(typeof draft.startLine === "number" ? { startLine: draft.startLine } : {}),
    line: draft.line,
    side: draft.side,
  };
}

function extractFixReplacementText(finding: ProcessedReviewFinding | undefined): string | undefined {
  if (!finding) return undefined;
  const replacement = finding.fixReplacementText ?? finding.replacementText;
  return typeof replacement === "string" ? replacement : undefined;
}

function isReducerDeniedReason(reason: ReviewCandidateApprovalReason | undefined): boolean {
  return reason === "reducer-suppressed"
    || reason === "reducer-low-confidence"
    || reason === "reducer-deprioritized"
    || reason === "missing-reducer-visibility"
    || reason === "reducer-degraded-fail-open";
}

function buildVisibleFindingJoin(findings: ReadonlyArray<ProcessedReviewFinding>): Map<string, ProcessedReviewFinding> {
  const joined = new Map<string, ProcessedReviewFinding>();
  for (const finding of findings) {
    const fingerprint = typeof finding.candidateFingerprint === "string" ? finding.candidateFingerprint.trim() : "";
    if (!isValidCandidateFingerprint(fingerprint) || joined.has(fingerprint)) continue;
    joined.set(fingerprint, finding);
  }
  return joined;
}

function toInlineCommentLocation(candidate: ReviewCandidateFinding):
  | { location: InlineCommentLocation }
  | { reason: ReviewCandidatePublicationSkipReason } {
  if (typeof candidate.filePath !== "string" || candidate.filePath.trim().length === 0) {
    return { reason: "missing-path" };
  }
  if (isUnsafeFilePath(candidate.filePath)) {
    return { reason: "unsafe-path" };
  }
  if (candidate.startLine === undefined && candidate.endLine === undefined) {
    return { reason: "missing-line" };
  }
  const startLine = normalizePositiveInteger(candidate.startLine);
  const endLine = normalizePositiveInteger(candidate.endLine ?? candidate.startLine);
  if (startLine === null || endLine === null || startLine > endLine) {
    return { reason: "invalid-line-range" };
  }

  if (startLine === endLine) {
    return { location: { path: candidate.filePath, line: endLine, side: "RIGHT" } };
  }

  return { location: { path: candidate.filePath, startLine, line: endLine, side: "RIGHT" } };
}

function toProcessedFindingDraft(
  sourceFinding: ReviewCandidateFinding | ProcessedReviewFinding,
  candidate: ReviewCandidateFinding,
  reference: ReviewCandidateApprovalCandidateReference,
): ProcessedReviewFindingDraft {
  const source = sourceFinding as ProcessedReviewFinding & { body?: unknown };
  const candidateBody = candidate.body;
  const sourceBody = typeof source.body === "string" && source.body.trim().length > 0 ? source.body : candidateBody;
  return {
    filePath: normalizeText(source.filePath, candidate.filePath),
    title: normalizeText(source.title, candidate.title),
    severity: normalizeSeverity(source.severity ?? candidate.severity),
    category: normalizeCategory(source.category ?? candidate.category),
    ...(typeof source.startLine === "number" ? { startLine: source.startLine } : typeof candidate.startLine === "number" ? { startLine: candidate.startLine } : {}),
    ...(typeof source.endLine === "number" ? { endLine: source.endLine } : typeof candidate.endLine === "number" ? { endLine: candidate.endLine } : {}),
    ...(typeof source.confidence === "number" ? { confidence: source.confidence } : {}),
    ...(typeof source.filterAction === "string" ? { filterAction: source.filterAction } : {}),
    ...(typeof source.originalTitle === "string" ? { originalTitle: source.originalTitle } : {}),
    body: sourceBody,
    candidateFingerprint: reference.fingerprint,
    candidatePublicationLifecycle: reference.lifecycle,
    ...(reference.reason ? { candidatePublicationReason: reference.reason } : {}),
  };
}

function skip(
  fingerprint: string,
  lifecycle: ReviewCandidatePublicationLifecycle,
  reason: ReviewCandidatePublicationSkipReason,
  context: Partial<Pick<ReviewCandidatePublicationAdapterSkipped, "sourceReason" | "filePath" | "startLine" | "endLine">> = {},
): ReviewCandidatePublicationAdapterSkipped {
  return {
    fingerprint: sanitizeSummaryToken(fingerprint),
    lifecycle,
    reason,
    ...(context.sourceReason ? { sourceReason: context.sourceReason } : {}),
    ...(context.filePath ? { filePath: context.filePath } : {}),
    ...(typeof context.startLine === "number" ? { startLine: context.startLine } : {}),
    ...(typeof context.endLine === "number" ? { endLine: context.endLine } : {}),
  };
}

function isCandidateFinding(value: unknown): value is ReviewCandidateFinding {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReviewCandidateFinding>;
  return typeof candidate.fingerprint === "string"
    && typeof candidate.filePath === "string"
    && typeof candidate.title === "string"
    && typeof candidate.body === "string";
}

function isValidCandidateFingerprint(value: string): boolean {
  return /^rcf-[a-f0-9]{16}(?:-\d+)?$/.test(value);
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return null;
  }
  return Math.floor(value);
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeSeverity(value: unknown): FindingSeverity {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "critical" || normalized === "major" || normalized === "medium" || normalized === "minor") {
    return normalized;
  }
  return "medium";
}

function normalizeCategory(value: unknown): FindingCategory {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "security") return "security";
  if (normalized === "correctness" || normalized === "error-handling") return "correctness";
  if (normalized === "performance" || normalized === "resource-management" || normalized === "concurrency") return "performance";
  if (normalized === "style") return "style";
  if (normalized === "documentation") return "documentation";
  return "correctness";
}

function isUnsafeFilePath(value: string): boolean {
  return value.startsWith("/") || value.includes("..") || /^[a-zA-Z]:[\\/]/.test(value);
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
    .replace(/[^a-zA-Z0-9._:,\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);

  return normalized || "unknown";
}

function boundSummary(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}
