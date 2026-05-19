import { createHash } from "node:crypto";
import type { FindingCategory, FindingSeverity } from "../lib/review-utils.ts";

export type ReviewCandidateFindingMode = "shadow" | "unavailable";
export type ReviewCandidateFindingExecutionStatus = ReviewCandidateFindingMode | "degraded";
export type ReviewCandidateFindingRejectionReason =
  | "missing-correlation"
  | "missing-file-path"
  | "unsafe-file-path"
  | "missing-title"
  | "missing-body"
  | "field-too-long"
  | "invalid-line-range"
  | "unsafe-text";

export const MAX_REVIEW_CANDIDATE_TITLE_LENGTH = 160;
export const MAX_REVIEW_CANDIDATE_BODY_LENGTH = 2_000;
export const MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH = 1_000;
export const MAX_REVIEW_CANDIDATE_FIX_REPLACEMENT_LENGTH = 8_000;
export const MAX_REVIEW_CANDIDATE_FILE_PATH_LENGTH = 512;
export const MAX_REVIEW_CANDIDATE_SUMMARY_LENGTH = 260;

export type ReviewCandidateFindingInput = {
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string | null;
  mode?: ReviewCandidateFindingMode;
  reason?: string | null;
  artifactPresent?: boolean;
  candidates?: ReadonlyArray<ReviewCandidateFindingCandidateInput> | null;
  unsafeTextDetector?: (value: string) => boolean;
  logger?: {
    warn: (obj: unknown, msg: string) => void;
  };
};

export type ReviewCandidateFindingCandidateInput = {
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  severity?: string | null;
  category?: string | null;
  title?: string | null;
  body?: string | null;
  evidence?: string | null;
  fixReplacementText?: string | null;
};

export type ReviewCandidateFinding = {
  fingerprint: string;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  body: string;
  evidence?: string;
  fixReplacementText?: string;
};

export type ReviewCandidateFindingCounts = {
  input: number;
  recorded: number;
  rejected: number;
  errors: number;
};

export type ReviewCandidateFindingRejection = {
  index: number;
  reason: ReviewCandidateFindingRejectionReason;
};

export type ReviewCandidateFindingExecutionResult = {
  status: ReviewCandidateFindingExecutionStatus;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  artifactPresent: boolean;
  /** Safe sidecar artifact basename only; never an absolute workspace path. */
  artifactBasename?: string;
  findings: ReviewCandidateFinding[];
  rejections: ReviewCandidateFindingRejection[];
  counts: ReviewCandidateFindingCounts;
  reason?: string;
};

export type ReviewCandidateFindingDetailsSummary = {
  label: "Review candidates";
  status: ReviewCandidateFindingExecutionStatus;
  text: string;
};

export type ReviewCandidateFindingRecorder = {
  recordCandidateFinding: (
    finding: ReviewCandidateFinding,
    context: {
      repo: string;
      pullNumber: number;
      reviewOutputKey: string;
      deliveryId?: string;
    },
  ) => Promise<void> | void;
  recordCandidateFindingRejection?: (
    rejection: ReviewCandidateFindingRejection,
    context: {
      repo: string;
      pullNumber: number;
      reviewOutputKey: string;
      deliveryId?: string;
    },
  ) => Promise<void> | void;
  recordCandidateFindingError?: (
    reason: string,
    context: {
      repo: string;
      pullNumber: number;
      reviewOutputKey: string;
      deliveryId?: string;
    },
  ) => Promise<void> | void;
};

export function createReviewCandidateFindingExecutionResult(
  input: ReviewCandidateFindingInput,
): ReviewCandidateFindingExecutionResult {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const inputCount = candidates.length;
  const repo = normalizeRequiredString(input.repo);
  const pullNumber = Number.isFinite(input.pullNumber) && input.pullNumber > 0
    ? Math.floor(input.pullNumber)
    : 0;
  const reviewOutputKey = normalizeRequiredString(input.reviewOutputKey);
  const deliveryId = normalizeOptionalString(input.deliveryId);
  const artifactPresent = input.artifactPresent === true;

  if (input.mode === "unavailable") {
    return {
      status: "unavailable",
      repo,
      pullNumber,
      reviewOutputKey,
      ...(deliveryId ? { deliveryId } : {}),
      artifactPresent,
      findings: [],
      rejections: [],
      counts: { input: inputCount, recorded: 0, rejected: 0, errors: 0 },
      ...(input.reason ? { reason: sanitizeSummaryToken(input.reason) } : {}),
    };
  }

  if (!repo || pullNumber <= 0 || !reviewOutputKey) {
    return {
      status: "unavailable",
      repo,
      pullNumber,
      reviewOutputKey,
      ...(deliveryId ? { deliveryId } : {}),
      artifactPresent,
      findings: [],
      rejections: candidates.map((_, index) => ({ index, reason: "missing-correlation" as const })),
      counts: { input: inputCount, recorded: 0, rejected: inputCount, errors: 0 },
      reason: "missing-correlation",
    };
  }

  try {
    const findings: ReviewCandidateFinding[] = [];
    const rejections: ReviewCandidateFindingRejection[] = [];
    const fingerprintCounts = new Map<string, number>();

    candidates.forEach((candidate, index) => {
      const normalized = normalizeCandidate({
        candidate,
        index,
        repo,
        pullNumber,
        reviewOutputKey,
        deliveryId,
        unsafeTextDetector: input.unsafeTextDetector ?? defaultUnsafeTextDetector,
      });

      if ("reason" in normalized) {
        rejections.push({ index, reason: normalized.reason });
        return;
      }

      const duplicateCount = (fingerprintCounts.get(normalized.finding.fingerprint) ?? 0) + 1;
      fingerprintCounts.set(normalized.finding.fingerprint, duplicateCount);
      findings.push({
        ...normalized.finding,
        fingerprint: duplicateCount === 1
          ? normalized.finding.fingerprint
          : `${normalized.finding.fingerprint}-${duplicateCount}`,
      });
    });

    return {
      status: "shadow",
      repo,
      pullNumber,
      reviewOutputKey,
      ...(deliveryId ? { deliveryId } : {}),
      artifactPresent,
      findings,
      rejections,
      counts: {
        input: inputCount,
        recorded: findings.length,
        rejected: rejections.length,
        errors: 0,
      },
    };
  } catch (err) {
    input.logger?.warn(
      {
        repo,
        pullNumber,
        reviewOutputKey,
        ...(deliveryId ? { deliveryId } : {}),
        inputCount,
        err,
      },
      "Review candidate finding normalization failed",
    );
    return createDegradedReviewCandidateFindingResult({
      repo,
      pullNumber,
      reviewOutputKey,
      deliveryId,
      artifactPresent,
      inputCount,
      reason: "normalization-error",
    });
  }
}

export function createDegradedReviewCandidateFindingResult(input: {
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string | null;
  artifactPresent?: boolean;
  reason: string;
  inputCount?: number;
}): ReviewCandidateFindingExecutionResult {
  const deliveryId = normalizeOptionalString(input.deliveryId);
  return {
    status: "degraded",
    repo: normalizeRequiredString(input.repo),
    pullNumber: Number.isFinite(input.pullNumber) && input.pullNumber > 0 ? Math.floor(input.pullNumber) : 0,
    reviewOutputKey: normalizeRequiredString(input.reviewOutputKey),
    ...(deliveryId ? { deliveryId } : {}),
    artifactPresent: input.artifactPresent === true,
    findings: [],
    rejections: [],
    counts: {
      input: Math.max(0, Math.floor(Number.isFinite(input.inputCount) ? input.inputCount ?? 0 : 0)),
      recorded: 0,
      rejected: 0,
      errors: 1,
    },
    reason: sanitizeSummaryToken(input.reason),
  };
}

export function toReviewCandidateFindingDetailsSummary(
  result: ReviewCandidateFindingExecutionResult,
): ReviewCandidateFindingDetailsSummary {
  const reason = result.reason ? ` reason=${sanitizeSummaryToken(result.reason)}` : "";
  const delivery = result.deliveryId ? ` delivery=${sanitizeSummaryToken(result.deliveryId)}` : "";
  const text = boundSummary([
    `Review candidates: ${result.status}`,
    `recorded=${formatCount(result.counts.recorded)}`,
    `rejected=${formatCount(result.counts.rejected)}`,
    `errors=${formatCount(result.counts.errors)}`,
    `artifact=${result.artifactPresent ? "present" : "absent"}${reason}`,
    `repo=${sanitizeSummaryToken(result.repo.replace("/", "-"))}`,
    `pr=${formatCount(result.pullNumber)}`,
    `key=${sanitizeSummaryToken(result.reviewOutputKey)}`,
    delivery.trim(),
  ].filter(Boolean).join(" "));

  return {
    label: "Review candidates",
    status: result.status,
    text,
  };
}

function normalizeCandidate(input: {
  candidate: ReviewCandidateFindingCandidateInput;
  index: number;
  repo: string;
  pullNumber: number;
  reviewOutputKey: string;
  deliveryId?: string;
  unsafeTextDetector: (value: string) => boolean;
}): { finding: ReviewCandidateFinding } | { reason: ReviewCandidateFindingRejectionReason } {
  const filePath = normalizeRequiredString(input.candidate.filePath);
  if (!filePath) {
    return { reason: "missing-file-path" };
  }
  if (isUnsafeFilePath(filePath)) {
    return { reason: "unsafe-file-path" };
  }

  const title = normalizeRequiredString(input.candidate.title);
  if (!title) {
    return { reason: "missing-title" };
  }

  const body = normalizeRequiredString(input.candidate.body);
  if (!body) {
    return { reason: "missing-body" };
  }

  const evidence = normalizeOptionalString(input.candidate.evidence);
  const fixReplacementText = normalizeOptionalMultilineString(input.candidate.fixReplacementText);
  if (
    filePath.length > MAX_REVIEW_CANDIDATE_FILE_PATH_LENGTH
    || title.length > MAX_REVIEW_CANDIDATE_TITLE_LENGTH
    || body.length > MAX_REVIEW_CANDIDATE_BODY_LENGTH
    || (evidence?.length ?? 0) > MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH
    || (fixReplacementText?.length ?? 0) > MAX_REVIEW_CANDIDATE_FIX_REPLACEMENT_LENGTH
  ) {
    return { reason: "field-too-long" };
  }

  const lineRange = normalizeLineRange(input.candidate.startLine, input.candidate.endLine);
  if (lineRange === null) {
    return { reason: "invalid-line-range" };
  }

  const unsafeText = [filePath, title, body, evidence, fixReplacementText]
    .filter((value): value is string => typeof value === "string")
    .some((value) => input.unsafeTextDetector(value));
  if (unsafeText) {
    return { reason: "unsafe-text" };
  }

  const baseFinding = {
    repo: input.repo,
    pullNumber: input.pullNumber,
    reviewOutputKey: input.reviewOutputKey,
    ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    filePath,
    ...lineRange,
    severity: normalizeCandidateSeverity(input.candidate.severity),
    category: normalizeCandidateCategory(input.candidate.category),
    title,
    body,
    ...(evidence ? { evidence } : {}),
    ...(fixReplacementText ? { fixReplacementText } : {}),
  } satisfies Omit<ReviewCandidateFinding, "fingerprint">;

  return {
    finding: {
      ...baseFinding,
      fingerprint: fingerprintCandidate(baseFinding),
    },
  };
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeRequiredString(value);
  return normalized || undefined;
}

function normalizeOptionalMultilineString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\t ]+$/gm, "")
    .replace(/\n+$/g, "");
  return normalized.trim().length > 0 ? normalized : undefined;
}

function normalizeLineRange(
  startLine: number | null | undefined,
  endLine: number | null | undefined,
): { startLine?: number; endLine?: number } | null {
  if (startLine === undefined || startLine === null) {
    if (endLine === undefined || endLine === null) {
      return {};
    }
    return null;
  }

  if (!Number.isFinite(startLine) || startLine <= 0) {
    return null;
  }

  const normalizedStart = Math.floor(startLine);
  if (endLine === undefined || endLine === null) {
    return { startLine: normalizedStart };
  }

  if (!Number.isFinite(endLine) || endLine <= 0) {
    return null;
  }

  const normalizedEnd = Math.floor(endLine);
  if (normalizedStart > normalizedEnd) {
    return null;
  }

  return { startLine: normalizedStart, endLine: normalizedEnd };
}

function normalizeCandidateSeverity(value: unknown): FindingSeverity {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "critical" || normalized === "major" || normalized === "medium" || normalized === "minor") {
    return normalized;
  }
  return "medium";
}

function normalizeCandidateCategory(value: unknown): FindingCategory {
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

function defaultUnsafeTextDetector(value: string): boolean {
  return /sk-[a-zA-Z0-9_-]{8,}/.test(value)
    || /gh[pousr]_[a-zA-Z0-9_]{8,}/.test(value)
    || /(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s]+/i.test(value)
    || /BEGIN\s+PROMPT|system prompt|hidden instructions/i.test(value)
    || /diff --git/i.test(value);
}

function fingerprintCandidate(value: Omit<ReviewCandidateFinding, "fingerprint">): string {
  const canonical = [
    value.repo,
    value.pullNumber,
    value.reviewOutputKey,
    value.filePath,
    value.startLine ?? "",
    value.endLine ?? "",
    value.severity,
    value.category,
    value.title.toLowerCase(),
  ].join("\u001f");
  return `rcf-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }
  return Math.floor(value).toString();
}

function sanitizeSummaryToken(value: string): string {
  const normalized = value
    .replace(/sk-[a-zA-Z0-9_-]+/g, "redacted")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/g, "redacted")
    .replace(/TOKEN\s*=\s*[^\s]+/gi, "token-redacted")
    .replace(/PROMPT[_-]?SECRET/gi, "prompt-redacted")
    .replace(/diff --git/gi, "diff-redacted")
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return normalized || "unknown";
}

function boundSummary(value: string): string {
  return value.length <= MAX_REVIEW_CANDIDATE_SUMMARY_LENGTH
    ? value
    : `${value.slice(0, MAX_REVIEW_CANDIDATE_SUMMARY_LENGTH - 1)}…`;
}
