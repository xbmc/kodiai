import type {
  ReviewCandidateFinding,
  ReviewCandidateFindingExecutionResult,
  ReviewCandidateFindingRejectionReason,
} from "./review-candidate-finding.ts";
import type { ProcessedReviewFinding, ReviewReducerResult } from "./review-reducer.ts";

export type ReviewCandidateApprovalLifecycle =
  | "approved"
  | "suppressed"
  | "deduped"
  | "rewritten"
  | "rejected"
  | "fallback-disallowed";

export type ReviewCandidateApprovalReason =
  | "candidate-approved"
  | "reducer-rewritten"
  | "reducer-suppressed"
  | "reducer-low-confidence"
  | "reducer-deprioritized"
  | "missing-candidate-join"
  | "missing-reducer-visibility"
  | "duplicate-candidate-fingerprint"
  | "candidate-rejected"
  | "candidate-unavailable"
  | "candidate-degraded"
  | "candidate-empty"
  | "direct-fallback-disallowed"
  | "reducer-degraded-fail-open";

export type ReviewCandidateApprovalFallbackPolicy = {
  allowDirectFallback?: boolean;
  attemptedDirectFallback?: boolean;
};

export type ReviewCandidateApprovalInput = {
  candidates: ReviewCandidateFindingExecutionResult;
  reducer: ReviewReducerResult;
  fallbackPolicy?: ReviewCandidateApprovalFallbackPolicy;
};

export type ReviewCandidateApprovalCounts = {
  input: number;
  approved: number;
  rewritten: number;
  suppressed: number;
  deduped: number;
  rejected: number;
  fallbackDisallowed: number;
  auditEvents: number;
};

export type ReviewCandidateApprovalAuditEvent = {
  lifecycle: ReviewCandidateApprovalLifecycle;
  reason: ReviewCandidateApprovalReason;
  count?: number;
};

export type ReviewCandidateApprovalOutcome = {
  lifecycle: ReviewCandidateApprovalLifecycle;
  reason: ReviewCandidateApprovalReason | ReviewCandidateFindingRejectionReason;
  fingerprint: string;
};

export type ReviewCandidateApprovalCandidateReference = {
  lifecycle: "approved" | "rewritten";
  fingerprint: string;
  candidate: ReviewCandidateFinding;
  reason?: ReviewCandidateApprovalReason;
};

export type ReviewCandidateApprovalDetailsSummary = {
  label: "Review candidate approval";
  text: string;
};

export type ReviewCandidateApprovalResult = {
  outcomes: ReviewCandidateApprovalOutcome[];
  approvedCandidates: ReviewCandidateApprovalCandidateReference[];
  rewrittenCandidates: ReviewCandidateApprovalCandidateReference[];
  counts: ReviewCandidateApprovalCounts;
  audit: ReviewCandidateApprovalAuditEvent[];
  detailsSummary: ReviewCandidateApprovalDetailsSummary;
};

const MAX_SUMMARY_LENGTH = 260;
const MAX_REASON_CODES = 12;

export function coordinateReviewCandidateApproval(input: ReviewCandidateApprovalInput): ReviewCandidateApprovalResult {
  const outcomes: ReviewCandidateApprovalOutcome[] = [];
  const approvedCandidates: ReviewCandidateApprovalCandidateReference[] = [];
  const rewrittenCandidates: ReviewCandidateApprovalCandidateReference[] = [];
  const audit: ReviewCandidateApprovalAuditEvent[] = [];
  const baseFingerprintCounts = new Map<string, number>();
  const consumedFingerprints = new Set<string>();

  if (input.candidates.status === "unavailable") {
    pushSyntheticOutcome(outcomes, audit, "suppressed", "candidate-unavailable");
  }

  if (input.candidates.status === "degraded") {
    pushSyntheticOutcome(outcomes, audit, "suppressed", "candidate-degraded");
  }

  if (input.candidates.status === "shadow" && input.candidates.counts.input === 0) {
    pushSyntheticOutcome(outcomes, audit, "suppressed", "candidate-empty");
  }

  for (const rejection of input.candidates.rejections) {
    outcomes.push({
      lifecycle: "rejected",
      reason: rejection.reason,
      fingerprint: `rejected-${formatCount(rejection.index)}`,
    });
    audit.push({ lifecycle: "rejected", reason: "candidate-rejected" });
  }

  const reducerJoin = buildReducerJoin(input.reducer);

  if (input.reducer.status === "degraded") {
    audit.push({ lifecycle: "suppressed", reason: "reducer-degraded-fail-open" });
    for (const candidate of input.candidates.findings) {
      outcomes.push({
        lifecycle: "suppressed",
        reason: "reducer-degraded-fail-open",
        fingerprint: candidate.fingerprint,
      });
      consumedFingerprints.add(candidate.fingerprint);
    }
  } else {
    for (const candidate of input.candidates.findings) {
      const baseFingerprint = normalizeBaseFingerprint(candidate.fingerprint);
      const seenCount = (baseFingerprintCounts.get(baseFingerprint) ?? 0) + 1;
      baseFingerprintCounts.set(baseFingerprint, seenCount);
      if (seenCount > 1) {
        outcomes.push({
          lifecycle: "deduped",
          reason: "duplicate-candidate-fingerprint",
          fingerprint: candidate.fingerprint,
        });
        audit.push({ lifecycle: "deduped", reason: "duplicate-candidate-fingerprint" });
        consumedFingerprints.add(candidate.fingerprint);
        continue;
      }

      const joined = reducerJoin.get(candidate.fingerprint);
      if (!joined) {
        const reason = hasUnjoinedReducerProjection(input.reducer, candidate)
          ? "missing-candidate-join"
          : "missing-reducer-visibility";
        outcomes.push({
          lifecycle: "suppressed",
          reason,
          fingerprint: candidate.fingerprint,
        });
        audit.push({ lifecycle: "suppressed", reason });
        consumedFingerprints.add(candidate.fingerprint);
        continue;
      }

      const lifecycle = classifyJoinedReducerFinding(joined);
      if (lifecycle.reason === "candidate-approved") {
        outcomes.push({ lifecycle: "approved", reason: lifecycle.reason, fingerprint: candidate.fingerprint });
        approvedCandidates.push({ lifecycle: "approved", fingerprint: candidate.fingerprint, candidate });
        audit.push({ lifecycle: "approved", reason: lifecycle.reason });
      } else if (lifecycle.reason === "reducer-rewritten") {
        outcomes.push({ lifecycle: "rewritten", reason: lifecycle.reason, fingerprint: candidate.fingerprint });
        rewrittenCandidates.push({ lifecycle: "rewritten", fingerprint: candidate.fingerprint, candidate, reason: lifecycle.reason });
        audit.push({ lifecycle: "rewritten", reason: lifecycle.reason });
      } else {
        outcomes.push({ lifecycle: "suppressed", reason: lifecycle.reason, fingerprint: candidate.fingerprint });
        audit.push({ lifecycle: "suppressed", reason: lifecycle.reason });
      }
      consumedFingerprints.add(candidate.fingerprint);
    }

    for (const [fingerprint] of reducerJoin) {
      if (consumedFingerprints.has(fingerprint)) continue;
      outcomes.push({
        lifecycle: "suppressed",
        reason: "missing-candidate-join",
        fingerprint,
      });
      audit.push({ lifecycle: "suppressed", reason: "missing-candidate-join" });
    }

  }

  if (input.fallbackPolicy?.attemptedDirectFallback === true && input.fallbackPolicy.allowDirectFallback !== true) {
    outcomes.push({
      lifecycle: "fallback-disallowed",
      reason: "direct-fallback-disallowed",
      fingerprint: "fallback-disallowed",
    });
    audit.push({ lifecycle: "fallback-disallowed", reason: "direct-fallback-disallowed" });
  }

  const counts = buildCounts(input, outcomes, audit.length);
  const resultWithoutSummary = { outcomes, approvedCandidates, rewrittenCandidates, counts, audit };
  const detailsSummary = toReviewCandidateApprovalDetailsSummary(resultWithoutSummary);
  return { ...resultWithoutSummary, detailsSummary };
}

export function toReviewCandidateApprovalDetailsSummary(result: Pick<ReviewCandidateApprovalResult, "counts" | "audit">): ReviewCandidateApprovalDetailsSummary {
  const reasonCodes = Array.from(new Set(result.audit.map((event) => event.reason))).slice(0, MAX_REASON_CODES);
  const reasons = reasonCodes.length > 0 ? reasonCodes.join(",") : "none";
  const text = boundSummary([
    "Review candidate approval:",
    `input=${formatCount(result.counts.input)}`,
    `approved=${formatCount(result.counts.approved)}`,
    `rewritten=${formatCount(result.counts.rewritten)}`,
    `suppressed=${formatCount(result.counts.suppressed)}`,
    `deduped=${formatCount(result.counts.deduped)}`,
    `rejected=${formatCount(result.counts.rejected)}`,
    `fallbackDisallowed=${formatCount(result.counts.fallbackDisallowed)}`,
    `auditEvents=${formatCount(result.counts.auditEvents)}`,
    `reasons=${sanitizeReasonList(reasons)}`,
  ].join(" "));

  return { label: "Review candidate approval", text };
}

function buildReducerJoin(reducer: ReviewReducerResult): Map<string, ProcessedReviewFinding> {
  const joined = new Map<string, ProcessedReviewFinding>();
  for (const finding of [...reducer.findings, ...reducer.visibleFindings, ...reducer.filteredInlineFindings, ...reducer.lowConfidenceFindings]) {
    const fingerprint = getCandidateFingerprint(finding);
    if (!fingerprint || joined.has(fingerprint)) continue;
    joined.set(fingerprint, finding);
  }
  return joined;
}

function classifyJoinedReducerFinding(finding: ProcessedReviewFinding): { reason: ReviewCandidateApprovalReason } {
  if (finding.filterAction === "rewritten" || finding.filterAction === "guardrail-rewritten" || typeof finding.originalTitle === "string") {
    return { reason: "reducer-rewritten" };
  }
  if (finding.suppressed === true || finding.filterAction === "suppressed" || finding.filterAction === "guardrail-suppressed") {
    return { reason: "reducer-suppressed" };
  }
  if (finding.deprioritized === true) {
    return { reason: "reducer-deprioritized" };
  }
  if (typeof finding.confidence === "number" && Number.isFinite(finding.confidence) && finding.confidence < 50) {
    return { reason: "reducer-low-confidence" };
  }
  return { reason: "candidate-approved" };
}

function getCandidateFingerprint(finding: ProcessedReviewFinding): string | undefined {
  const value = finding.candidateFingerprint;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^rcf-[a-f0-9]{16}(?:-\d+)?$/.test(normalized) ? normalized : undefined;
}

function normalizeBaseFingerprint(fingerprint: string): string {
  return fingerprint.replace(/-\d+$/, "");
}

function hasUnjoinedReducerProjection(reducer: ReviewReducerResult, candidate: ReviewCandidateFinding): boolean {
  return reducer.findings.some((finding) =>
    !getCandidateFingerprint(finding)
    && finding.filePath === candidate.filePath
    && finding.title === candidate.title
  );
}

function pushSyntheticOutcome(
  outcomes: ReviewCandidateApprovalOutcome[],
  audit: ReviewCandidateApprovalAuditEvent[],
  lifecycle: "suppressed",
  reason: ReviewCandidateApprovalReason,
): void {
  outcomes.push({ lifecycle, reason, fingerprint: reason });
  audit.push({ lifecycle, reason });
}

function buildCounts(
  input: ReviewCandidateApprovalInput,
  outcomes: ReadonlyArray<ReviewCandidateApprovalOutcome>,
  auditEvents: number,
): ReviewCandidateApprovalCounts {
  return {
    input: input.candidates.counts.input,
    approved: outcomes.filter((outcome) => outcome.lifecycle === "approved").length,
    rewritten: outcomes.filter((outcome) => outcome.lifecycle === "rewritten").length,
    suppressed: outcomes.filter((outcome) => outcome.lifecycle === "suppressed").length,
    deduped: outcomes.filter((outcome) => outcome.lifecycle === "deduped").length,
    rejected: outcomes.filter((outcome) => outcome.lifecycle === "rejected").length,
    fallbackDisallowed: outcomes.filter((outcome) => outcome.lifecycle === "fallback-disallowed").length,
    auditEvents,
  };
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return Math.floor(value).toString();
}

function sanitizeReasonList(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET|BEGIN\s+PROMPT/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/[^a-zA-Z0-9._:,\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "none";
}

function boundSummary(value: string): string {
  return value.length <= MAX_SUMMARY_LENGTH ? value : `${value.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}
