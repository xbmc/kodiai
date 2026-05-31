import type { Logger } from "pino";
import type { ExtractedFinding } from "./review-comment-finding-extraction.ts";
import {
  createReviewCandidateFindingExecutionResult,
  type ReviewCandidateFindingExecutionResult,
} from "./review-candidate-finding.ts";
import { toProductionLogCandidateFindingSnapshot } from "../review-audit/production-log-projection.ts";

export type ReviewCandidateFindingSafeSnapshot = {
  status: ReviewCandidateFindingExecutionResult["status"];
  recorded: number;
  rejected: number;
  errors: number;
  artifactPresent: boolean;
  reason?: string;
};

export type ReviewCandidateReducerDraftFinding = ExtractedFinding & {
  confidence: number;
  body?: string;
  candidateFingerprint?: string;
  candidatePublicationLifecycle?: string;
  candidatePublicationDraft?: boolean;
};

export function sanitizeReviewCandidateReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const sanitized = value
    .trim()
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return sanitized || undefined;
}

export function normalizeReviewCandidateCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function resolveReviewCandidateFindingResult(params: {
  candidateFinding: unknown;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId: string;
}): ReviewCandidateFindingExecutionResult {
  const { candidateFinding, repo, pullNumber, reviewOutputKey, deliveryId } = params;

  if (typeof candidateFinding !== "object" || candidateFinding === null) {
    return createReviewCandidateFindingExecutionResult({
      repo,
      pullNumber,
      reviewOutputKey,
      deliveryId,
      mode: "unavailable",
      reason: "candidate-metadata-missing",
      artifactPresent: false,
    });
  }

  const raw = candidateFinding as Record<string, unknown>;
  const rawStatus = raw.status;
  const status: ReviewCandidateFindingExecutionResult["status"] = rawStatus === "shadow" || rawStatus === "degraded" || rawStatus === "unavailable"
    ? rawStatus
    : "degraded";
  const counts = typeof raw.counts === "object" && raw.counts !== null
    ? raw.counts as Record<string, unknown>
    : {};

  const rawCandidates = Array.isArray(raw.findings)
    ? raw.findings
    : Array.isArray(raw.candidates)
      ? raw.candidates
      : [];
  const normalized = createReviewCandidateFindingExecutionResult({
    repo,
    pullNumber,
    reviewOutputKey,
    deliveryId,
    mode: status === "unavailable" ? "unavailable" : "shadow",
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    artifactPresent: raw.artifactPresent === true,
    candidates: rawCandidates as Parameters<typeof createReviewCandidateFindingExecutionResult>[0]["candidates"],
  });

  if (status === "degraded") {
    return {
      ...normalized,
      status: "degraded",
      findings: [],
      rejections: [],
      counts: {
        input: normalizeReviewCandidateCount(counts.input),
        recorded: normalizeReviewCandidateCount(counts.recorded),
        rejected: normalizeReviewCandidateCount(counts.rejected),
        errors: normalizeReviewCandidateCount(counts.errors),
      },
      ...(sanitizeReviewCandidateReason(raw.reason) ? { reason: sanitizeReviewCandidateReason(raw.reason) } : {}),
    };
  }

  return {
    ...normalized,
    counts: {
      input: normalizeReviewCandidateCount(counts.input) || normalized.counts.input,
      recorded: normalizeReviewCandidateCount(counts.recorded) || normalized.counts.recorded,
      rejected: normalizeReviewCandidateCount(counts.rejected) || normalized.counts.rejected,
      errors: normalizeReviewCandidateCount(counts.errors) || normalized.counts.errors,
    },
    artifactPresent: raw.artifactPresent === true,
    ...(typeof raw.artifactBasename === "string" && raw.artifactBasename.trim() ? { artifactBasename: raw.artifactBasename.trim().split(/[\\/]/).pop() } : {}),
    ...(sanitizeReviewCandidateReason(raw.reason) ? { reason: sanitizeReviewCandidateReason(raw.reason) } : {}),
  };
}

export function toReviewCandidateFindingSafeSnapshot(
  result: ReviewCandidateFindingExecutionResult,
): ReviewCandidateFindingSafeSnapshot {
  return {
    status: result.status,
    recorded: result.counts.recorded,
    rejected: result.counts.rejected,
    errors: result.counts.errors,
    artifactPresent: result.artifactPresent,
    ...(result.status === "degraded" && result.reason ? { reason: sanitizeReviewCandidateReason(result.reason) } : {}),
  };
}

export function toReviewCandidateFindingProductionLogSnapshot(
  result: ReviewCandidateFindingExecutionResult,
) {
  const snapshot = toReviewCandidateFindingSafeSnapshot(result);
  return toProductionLogCandidateFindingSnapshot(snapshot);
}

export function logReviewCandidateFindingResult(params: {
  logger: Logger;
  baseLog: Record<string, unknown>;
  result: ReviewCandidateFindingExecutionResult;
}): void {
  const snapshot = toReviewCandidateFindingProductionLogSnapshot(params.result);
  const payload = {
    ...params.baseLog,
    gate: "review-candidate-finding",
    gateResult: snapshot.status,
    ...snapshot,
  };

  if (snapshot.status === "degraded") {
    params.logger.warn(payload, "Review candidate finding capture degraded (fail-open)");
    return;
  }

  params.logger.info(payload, "Review candidate finding capture summarized");
}

export function toReviewCandidateReducerDrafts(
  candidates: ReviewCandidateFindingExecutionResult,
): ReviewCandidateReducerDraftFinding[] {
  if (candidates.status !== "shadow") return [];

  return candidates.findings.map((candidate, index) => ({
    commentId: -(index + 1),
    filePath: candidate.filePath,
    title: candidate.title,
    severity: candidate.severity,
    category: candidate.category,
    ...(typeof candidate.startLine === "number" ? { startLine: candidate.startLine } : {}),
    ...(typeof candidate.endLine === "number" ? { endLine: candidate.endLine } : {}),
    confidence: 90,
    body: candidate.body,
    candidateFingerprint: candidate.fingerprint,
    candidatePublicationLifecycle: "candidate-draft",
    candidatePublicationDraft: true,
  }));
}
