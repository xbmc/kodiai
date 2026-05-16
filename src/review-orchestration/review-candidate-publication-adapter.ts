import type {
  InlineCommentLocation,
  InlineReviewPublicationReason,
  InlineReviewPublicationResult,
  InlineReviewPublicationStatus,
  PublishInlineReviewCommentInput,
} from "../execution/mcp/inline-review-publisher.ts";
import type { FindingCategory, FindingSeverity } from "../lib/review-utils.ts";
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

export type ReviewCandidatePublicationAdapterSkipped = {
  fingerprint: string;
  lifecycle: ReviewCandidatePublicationLifecycle;
  reason: ReviewCandidatePublicationSkipReason;
};

export type ReviewCandidatePublicationAdapterSummary = {
  counts: {
    input: number;
    publishable: number;
    skipped: number;
    approved: number;
    rewritten: number;
  };
  skipped: ReviewCandidatePublicationAdapterSkipped[];
  fingerprints: string[];
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
  };
  results: Array<{
    fingerprint: string;
    status: InlineReviewPublicationStatus | "missing" | "malformed";
    reason: ReviewCandidatePublisherResultReason;
    commentId?: number;
  }>;
};

export type ReviewCandidatePublishedFindingResult = {
  findings: ProcessedReviewFinding[];
  summary: ReviewCandidatePublishedResultSummary;
};

const MAX_SUMMARY_LENGTH = 280;
const MAX_SUMMARY_ITEMS = 20;

export function buildCandidateReviewOutputKey(reviewOutputKey: string, candidateFingerprint: string): string {
  const baseKey = typeof reviewOutputKey === "string" ? reviewOutputKey.trim() : "";
  const fingerprint = sanitizeSummaryToken(candidateFingerprint);
  return `${baseKey}:candidate:${fingerprint}`;
}

export function adaptApprovedCandidatesForInlinePublication(input: {
  approval: ReviewCandidateApprovalResult;
  reducer: Pick<ReviewReducerResult, "visibleFindings">;
}): ReviewCandidatePublicationAdapterResult {
  const visibleByFingerprint = buildVisibleFindingJoin(input.reducer.visibleFindings);
  const candidates = [
    ...input.approval.approvedCandidates,
    ...input.approval.rewrittenCandidates,
  ];
  const payloads: PublishableReviewCandidateInlinePayload[] = [];
  const skipped: ReviewCandidatePublicationAdapterSkipped[] = [];

  for (const reference of candidates) {
    const candidate = reference.candidate;
    if (!isCandidateFinding(candidate)) {
      skipped.push(skip(reference.fingerprint, reference.lifecycle, "missing-candidate"));
      continue;
    }

    const location = toInlineCommentLocation(candidate);
    if ("reason" in location) {
      skipped.push(skip(reference.fingerprint, reference.lifecycle, location.reason));
      continue;
    }

    const joinedFinding = visibleByFingerprint.get(reference.fingerprint);
    if (reference.lifecycle === "rewritten" && !joinedFinding) {
      skipped.push(skip(reference.fingerprint, reference.lifecycle, "missing-rewrite-visible-finding"));
      continue;
    }

    const sourceFinding = joinedFinding ?? candidate;
    const finding = toProcessedFindingDraft(sourceFinding, candidate, reference);
    const body = formatReviewCandidateInlineBody(finding);
    payloads.push({
      candidateFingerprint: reference.fingerprint,
      candidatePublicationLifecycle: reference.lifecycle,
      ...(reference.reason ? { sourceReason: reference.reason } : {}),
      source: joinedFinding ? "reducer-visible-finding" : "candidate",
      publication: { location: location.location, body },
      finding,
    });
  }

  const summary: ReviewCandidatePublicationAdapterSummary = {
    counts: {
      input: candidates.length,
      publishable: payloads.length,
      skipped: skipped.length,
      approved: payloads.filter((payload) => payload.candidatePublicationLifecycle === "approved").length,
      rewritten: payloads.filter((payload) => payload.candidatePublicationLifecycle === "rewritten").length,
    },
    skipped,
    fingerprints: payloads.map((payload) => payload.candidateFingerprint).slice(0, MAX_SUMMARY_ITEMS),
  };

  return { payloads, summary };
}

export function convertPublishedCandidateResultsToProcessedFindings(input: {
  payloads: ReadonlyArray<PublishableReviewCandidateInlinePayload>;
  results: ReadonlyMap<string, InlineReviewPublicationResult>;
}): ReviewCandidatePublishedFindingResult {
  const findings: ProcessedReviewFinding[] = [];
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
      results.push({
        fingerprint: payload.candidateFingerprint,
        status: result.status,
        reason: result.reason ?? result.status,
      });
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
    summary: {
      counts: {
        input: input.payloads.length,
        processed: findings.length,
        skipped: results.filter((result) => result.status === "skipped" || result.status === "missing").length,
        blocked: results.filter((result) => result.status === "blocked").length,
        failed: results.filter((result) => result.status === "failed").length,
        malformed: results.filter((result) => result.status === "malformed").length,
      },
      results,
    },
  };
}

export function toReviewCandidatePublicationAdapterSummary(
  summary: ReviewCandidatePublicationAdapterSummary,
): ReviewCandidatePublicationAdapterDetailsSummary {
  const reasons = Array.from(new Set(summary.skipped.map((item) => item.reason))).slice(0, MAX_SUMMARY_ITEMS);
  const fingerprints = summary.fingerprints.slice(0, MAX_SUMMARY_ITEMS).map(sanitizeSummaryToken);
  const text = boundSummary([
    "Review candidate publication adapter:",
    `input=${formatCount(summary.counts.input)}`,
    `publishable=${formatCount(summary.counts.publishable)}`,
    `skipped=${formatCount(summary.counts.skipped)}`,
    `approved=${formatCount(summary.counts.approved)}`,
    `rewritten=${formatCount(summary.counts.rewritten)}`,
    `reasons=${reasons.length > 0 ? reasons.map(sanitizeSummaryToken).join(",") : "none"}`,
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
): ReviewCandidatePublicationAdapterSkipped {
  return { fingerprint: sanitizeSummaryToken(fingerprint), lifecycle, reason };
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
