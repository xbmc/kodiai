export type ReviewTimeoutClassificationGate = "review-timeout-classification";

export type ReviewTimeoutClassification =
  | "expected-bounded-outcome"
  | "hard-failure"
  | "unknown";

export type ReviewTimeoutClassificationMode =
  | "bounded-partial-timeout"
  | "zero-evidence-hard-timeout"
  | "max-turns-continuation"
  | "chronic-timeout-skip"
  | "retry-enqueued"
  | "retry-completed"
  | "retry-failed"
  | "long-run-threshold-exceeded"
  | "unknown-malformed-evidence";

export type ReviewTimeoutReasonCode =
  | "partial-timeout"
  | "checkpoint-present"
  | "zero-evidence"
  | "timeout"
  | "max-turns"
  | "continuation-pending"
  | "chronic-timeout"
  | "continuation-skipped"
  | "retry-enqueued"
  | "retry-completed"
  | "retry-has-results"
  | "retry-no-results"
  | "retry-failed"
  | "long-run-threshold-exceeded"
  | "malformed-checkpoint"
  | "malformed-retry"
  | "unsafe-reason-code"
  | "unknown-mode"
  | "empty-reason-codes"
  | "unbounded-reason-codes"
  | "raw-canary-detected"
  | "safe-degraded"
  | "unknown-evidence";

export type ReviewTimeoutBoundedCounts = {
  checkpointFilesReviewed?: number;
  checkpointFilesInspected?: number;
  checkpointFindingCount?: number;
  checkpointTotalFiles?: number;
  retryFilesCount?: number;
  retryAttemptCount?: number;
  retryCompletedCount?: number;
  retryFailedCount?: number;
  recentTimeouts?: number;
  longRunDurationSeconds?: number;
  longRunThresholdSeconds?: number;
};

export type ReviewTimeoutRedactionFlags = {
  rawPayloadOmitted: true;
  boundedReasonCodes: boolean;
  unsafeInputOmitted: boolean;
  rawCanaryDetected: boolean;
};

export type ReviewTimeoutClassificationResult = {
  gate: ReviewTimeoutClassificationGate;
  classification: ReviewTimeoutClassification;
  mode: ReviewTimeoutClassificationMode;
  reasonCodes: ReviewTimeoutReasonCode[];
  expectedBoundedOutcome: boolean;
  hardFailure: boolean;
  counts: ReviewTimeoutBoundedCounts;
  redaction: ReviewTimeoutRedactionFlags;
};

type FirstPassLike = {
  state?: unknown;
  boundedReason?: unknown;
  evidenceSource?: unknown;
  continuationPending?: unknown;
  zeroEvidenceFailure?: unknown;
};

type CheckpointLike = {
  filesReviewed?: unknown;
  filesInspected?: unknown;
  findingCount?: unknown;
  totalFiles?: unknown;
};

type RetryLike = {
  enqueued?: unknown;
  completed?: unknown;
  failed?: unknown;
  hasResults?: unknown;
  filesCount?: unknown;
  files?: unknown;
  scopeRatio?: unknown;
  timeoutSeconds?: unknown;
  checkpointEnabled?: unknown;
  attemptCount?: unknown;
  completedCount?: unknown;
  failedCount?: unknown;
  riskLevel?: unknown;
};

type ContinuationLike = {
  decision?: unknown;
  reason?: unknown;
};

type OutcomeLike = {
  isTimeout?: unknown;
  stopReason?: unknown;
  failureSubtype?: unknown;
};

type LongRunLike = {
  thresholdExceeded?: unknown;
  durationSeconds?: unknown;
  thresholdSeconds?: unknown;
};

type EvidenceLike = {
  mode?: unknown;
  reasonCodes?: unknown;
  [key: string]: unknown;
};

export type ReviewTimeoutClassificationInput = {
  deliveryId?: unknown;
  reviewOutputKey?: unknown;
  outcome?: OutcomeLike | null;
  firstPass?: FirstPassLike | null;
  checkpoint?: CheckpointLike | null;
  retry?: RetryLike | null;
  continuation?: ContinuationLike | null;
  chronicTimeout?: unknown;
  recentTimeouts?: unknown;
  longRun?: LongRunLike | null;
  evidence?: EvidenceLike | null;
};

const MAX_REASON_CODES = 8;
const MAX_COUNT = 10_000;
const MAX_RECENT_TIMEOUTS = 100;
const MAX_RETRY_ATTEMPTS = 100;
const MAX_LONG_RUN_SECONDS = 86_400;

const REASON_CODES = new Set<ReviewTimeoutReasonCode>([
  "partial-timeout",
  "checkpoint-present",
  "zero-evidence",
  "timeout",
  "max-turns",
  "continuation-pending",
  "chronic-timeout",
  "continuation-skipped",
  "retry-enqueued",
  "retry-completed",
  "retry-has-results",
  "retry-no-results",
  "retry-failed",
  "long-run-threshold-exceeded",
  "malformed-checkpoint",
  "malformed-retry",
  "unsafe-reason-code",
  "unknown-mode",
  "empty-reason-codes",
  "unbounded-reason-codes",
  "raw-canary-detected",
  "safe-degraded",
  "unknown-evidence",
]);

const MODES = new Set<ReviewTimeoutClassificationMode>([
  "bounded-partial-timeout",
  "zero-evidence-hard-timeout",
  "max-turns-continuation",
  "chronic-timeout-skip",
  "retry-enqueued",
  "retry-completed",
  "retry-failed",
  "long-run-threshold-exceeded",
  "unknown-malformed-evidence",
]);

const RAW_CANARY_KEYS = new Set([
  "rawprompt",
  "rawmodeloutput",
  "rawoutput",
  "candidatebody",
  "candidatebodies",
  "diff",
  "diffcontent",
  "githubresponsepayload",
  "rawlogs",
  "logs",
  "secret",
  "secrets",
  "prompt",
  "modeloutput",
]);

const UNSAFE_VALUE_PATTERNS = [
  /BEGIN\s+PROMPT/i,
  /diff\s+--git/i,
  /\bTOKEN\s*=/i,
  /sk-[a-z0-9_-]{8,}/i,
  /secret/i,
  /\/home\//i,
];

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function boundedInteger(value: unknown, max: number): number | undefined {
  if (!isFiniteNonNegativeNumber(value)) return undefined;
  return Math.min(max, Math.floor(value));
}

function isUnsafeString(value: unknown): boolean {
  return typeof value === "string" && UNSAFE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function hasRawCanaryKeys(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (RAW_CANARY_KEYS.has(key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())) {
      return true;
    }
  }
  return false;
}

function hasUnsafeKnownValues(input: ReviewTimeoutClassificationInput): boolean {
  return isUnsafeString(input.retry?.riskLevel)
    || isUnsafeString(input.evidence?.mode)
    || (Array.isArray(input.evidence?.reasonCodes)
      && input.evidence.reasonCodes.slice(0, MAX_REASON_CODES + 1).some(isUnsafeString));
}

function hasRawCanary(input: ReviewTimeoutClassificationInput): boolean {
  return hasRawCanaryKeys(input)
    || hasRawCanaryKeys(input.evidence)
    || hasRawCanaryKeys(input.retry)
    || hasRawCanaryKeys(input.checkpoint)
    || hasRawCanaryKeys(input.firstPass)
    || hasRawCanaryKeys(input.continuation)
    || hasRawCanaryKeys(input.longRun)
    || hasRawCanaryKeys(input.outcome);
}

function uniqueReasons(reasons: readonly ReviewTimeoutReasonCode[]): ReviewTimeoutReasonCode[] {
  const bounded: ReviewTimeoutReasonCode[] = [];
  for (const reason of reasons) {
    if (!REASON_CODES.has(reason)) continue;
    if (bounded.includes(reason)) continue;
    bounded.push(reason);
    if (bounded.length >= MAX_REASON_CODES) break;
  }
  return bounded;
}

function parseEvidence(input: ReviewTimeoutClassificationInput): {
  malformed: boolean;
  mode?: ReviewTimeoutClassificationMode;
  reasonCodes?: ReviewTimeoutReasonCode[];
  reasonFailures: ReviewTimeoutReasonCode[];
} {
  if (!input.evidence) {
    return { malformed: false, reasonFailures: [] };
  }

  const reasonFailures: ReviewTimeoutReasonCode[] = [];
  const mode = typeof input.evidence.mode === "string" && MODES.has(input.evidence.mode as ReviewTimeoutClassificationMode)
    ? input.evidence.mode as ReviewTimeoutClassificationMode
    : undefined;
  if (input.evidence.mode !== undefined && !mode) {
    reasonFailures.push("unknown-mode");
  }

  const rawReasonCodes = input.evidence.reasonCodes;
  let reasonCodes: ReviewTimeoutReasonCode[] | undefined;
  if (rawReasonCodes !== undefined) {
    if (!Array.isArray(rawReasonCodes)) {
      reasonFailures.push("unsafe-reason-code");
    } else if (rawReasonCodes.length === 0) {
      reasonFailures.push("empty-reason-codes");
    } else if (rawReasonCodes.length > MAX_REASON_CODES) {
      reasonFailures.push("unbounded-reason-codes");
    } else {
      const safeReasons: ReviewTimeoutReasonCode[] = [];
      for (const reason of rawReasonCodes) {
        if (typeof reason !== "string" || isUnsafeString(reason) || !REASON_CODES.has(reason as ReviewTimeoutReasonCode)) {
          reasonFailures.push("unsafe-reason-code");
          continue;
        }
        safeReasons.push(reason as ReviewTimeoutReasonCode);
      }
      reasonCodes = uniqueReasons(safeReasons);
      if (reasonCodes.length === 0) {
        reasonFailures.push("empty-reason-codes");
      }
    }
  }

  return {
    malformed: reasonFailures.length > 0,
    mode,
    reasonCodes,
    reasonFailures: uniqueReasons(reasonFailures),
  };
}

function isMalformedCheckpoint(checkpoint: CheckpointLike | null | undefined): boolean {
  if (!checkpoint) return false;
  const reviewed = checkpoint.filesReviewed;
  const inspected = checkpoint.filesInspected;
  const total = checkpoint.totalFiles;
  const findingCount = checkpoint.findingCount;

  if (reviewed !== undefined && !isFiniteNonNegativeNumber(reviewed)) return true;
  if (inspected !== undefined && !isFiniteNonNegativeNumber(inspected)) return true;
  if (total !== undefined && !isFiniteNonNegativeNumber(total)) return true;
  if (findingCount !== undefined && !isFiniteNonNegativeNumber(findingCount)) return true;
  if (isFiniteNonNegativeNumber(reviewed) && isFiniteNonNegativeNumber(total) && reviewed > total) return true;
  if (isFiniteNonNegativeNumber(inspected) && isFiniteNonNegativeNumber(total) && inspected > total) return true;
  return false;
}

function isMalformedRetry(retry: RetryLike | null | undefined): boolean {
  if (!retry) return false;
  if (retry.files !== undefined && (!Array.isArray(retry.files) || retry.files.length > MAX_REASON_CODES)) return true;
  if (retry.filesCount !== undefined && !isFiniteNonNegativeNumber(retry.filesCount)) return true;
  if (retry.attemptCount !== undefined && !isFiniteNonNegativeNumber(retry.attemptCount)) return true;
  if (retry.completedCount !== undefined && !isFiniteNonNegativeNumber(retry.completedCount)) return true;
  if (retry.failedCount !== undefined && !isFiniteNonNegativeNumber(retry.failedCount)) return true;
  return false;
}

function buildCounts(input: ReviewTimeoutClassificationInput): ReviewTimeoutBoundedCounts {
  const counts: ReviewTimeoutBoundedCounts = {};
  const checkpointFilesReviewed = boundedInteger(input.checkpoint?.filesReviewed, MAX_COUNT);
  const checkpointFilesInspected = boundedInteger(input.checkpoint?.filesInspected, MAX_COUNT);
  const checkpointFindingCount = boundedInteger(input.checkpoint?.findingCount, MAX_COUNT);
  const checkpointTotalFiles = boundedInteger(input.checkpoint?.totalFiles, MAX_COUNT);
  const retryFilesCount = boundedInteger(input.retry?.filesCount, MAX_COUNT)
    ?? (Array.isArray(input.retry?.files) ? boundedInteger(input.retry.files.length, MAX_COUNT) : undefined);
  const retryAttemptCount = boundedInteger(input.retry?.attemptCount, MAX_RETRY_ATTEMPTS);
  const retryCompletedCount = boundedInteger(input.retry?.completedCount, MAX_RETRY_ATTEMPTS);
  const retryFailedCount = boundedInteger(input.retry?.failedCount, MAX_RETRY_ATTEMPTS);
  const recentTimeouts = boundedInteger(input.recentTimeouts, MAX_RECENT_TIMEOUTS);
  const longRunDurationSeconds = boundedInteger(input.longRun?.durationSeconds, MAX_LONG_RUN_SECONDS);
  const longRunThresholdSeconds = boundedInteger(input.longRun?.thresholdSeconds, MAX_LONG_RUN_SECONDS);

  if (checkpointFilesReviewed !== undefined) counts.checkpointFilesReviewed = checkpointFilesReviewed;
  if (checkpointFilesInspected !== undefined) counts.checkpointFilesInspected = checkpointFilesInspected;
  if (checkpointFindingCount !== undefined) counts.checkpointFindingCount = checkpointFindingCount;
  if (checkpointTotalFiles !== undefined) counts.checkpointTotalFiles = checkpointTotalFiles;
  if (retryFilesCount !== undefined) counts.retryFilesCount = retryFilesCount;
  if (retryAttemptCount !== undefined) counts.retryAttemptCount = retryAttemptCount;
  if (retryCompletedCount !== undefined) counts.retryCompletedCount = retryCompletedCount;
  if (retryFailedCount !== undefined) counts.retryFailedCount = retryFailedCount;
  if (recentTimeouts !== undefined) counts.recentTimeouts = recentTimeouts;
  if (longRunDurationSeconds !== undefined) counts.longRunDurationSeconds = longRunDurationSeconds;
  if (longRunThresholdSeconds !== undefined) counts.longRunThresholdSeconds = longRunThresholdSeconds;
  return counts;
}

function deriveClassification(input: ReviewTimeoutClassificationInput, evidenceMode?: ReviewTimeoutClassificationMode): {
  mode: ReviewTimeoutClassificationMode;
  reasonCodes: ReviewTimeoutReasonCode[];
  hardFailure: boolean;
  expectedBoundedOutcome: boolean;
} {
  if (input.longRun?.thresholdExceeded === true || evidenceMode === "long-run-threshold-exceeded") {
    return {
      mode: "long-run-threshold-exceeded",
      reasonCodes: ["long-run-threshold-exceeded"],
      hardFailure: true,
      expectedBoundedOutcome: false,
    };
  }

  if (input.retry?.failed === true || evidenceMode === "retry-failed") {
    return { mode: "retry-failed", reasonCodes: ["retry-failed"], hardFailure: true, expectedBoundedOutcome: false };
  }

  if (input.retry?.completed === true || evidenceMode === "retry-completed") {
    return {
      mode: "retry-completed",
      reasonCodes: ["retry-completed", input.retry?.hasResults === false ? "retry-no-results" : "retry-has-results"],
      hardFailure: false,
      expectedBoundedOutcome: true,
    };
  }

  if (input.chronicTimeout === true || input.continuation?.reason === "chronic-timeout" || evidenceMode === "chronic-timeout-skip") {
    return {
      mode: "chronic-timeout-skip",
      reasonCodes: ["chronic-timeout", "continuation-skipped"],
      hardFailure: true,
      expectedBoundedOutcome: false,
    };
  }

  if (input.firstPass?.zeroEvidenceFailure === true || input.firstPass?.state === "zero-evidence-failure" || evidenceMode === "zero-evidence-hard-timeout") {
    return {
      mode: "zero-evidence-hard-timeout",
      reasonCodes: ["zero-evidence", "timeout"],
      hardFailure: true,
      expectedBoundedOutcome: false,
    };
  }

  if (input.outcome?.stopReason === "max_turns" || input.outcome?.failureSubtype === "error_max_turns" || input.firstPass?.boundedReason === "max-turns" || evidenceMode === "max-turns-continuation") {
    return {
      mode: "max-turns-continuation",
      reasonCodes: ["max-turns", "continuation-pending"],
      hardFailure: false,
      expectedBoundedOutcome: true,
    };
  }

  if (input.retry?.enqueued === true || evidenceMode === "retry-enqueued") {
    return { mode: "retry-enqueued", reasonCodes: ["retry-enqueued"], hardFailure: false, expectedBoundedOutcome: true };
  }

  if (input.outcome?.isTimeout === true || input.firstPass?.boundedReason === "timeout" || evidenceMode === "bounded-partial-timeout") {
    return {
      mode: "bounded-partial-timeout",
      reasonCodes: ["partial-timeout", "checkpoint-present"],
      hardFailure: false,
      expectedBoundedOutcome: true,
    };
  }

  return {
    mode: "unknown-malformed-evidence",
    reasonCodes: ["unknown-evidence", "safe-degraded"],
    hardFailure: true,
    expectedBoundedOutcome: false,
  };
}

function failClosed(reasons: readonly ReviewTimeoutReasonCode[], counts: ReviewTimeoutBoundedCounts, rawCanaryDetected: boolean): ReviewTimeoutClassificationResult {
  return {
    gate: "review-timeout-classification",
    classification: "hard-failure",
    mode: "unknown-malformed-evidence",
    reasonCodes: uniqueReasons([...reasons, "safe-degraded"]),
    expectedBoundedOutcome: false,
    hardFailure: true,
    counts,
    redaction: {
      rawPayloadOmitted: true,
      boundedReasonCodes: false,
      unsafeInputOmitted: true,
      rawCanaryDetected,
    },
  };
}

export function classifyReviewTimeoutOutcome(input: ReviewTimeoutClassificationInput): ReviewTimeoutClassificationResult {
  const counts = buildCounts(input);
  const evidence = parseEvidence(input);
  const malformedCheckpoint = isMalformedCheckpoint(input.checkpoint);
  const malformedRetry = isMalformedRetry(input.retry);
  const rawCanaryDetected = hasRawCanary(input);
  const unsafeKnownValues = hasUnsafeKnownValues(input);

  const failReasons: ReviewTimeoutReasonCode[] = [];
  if (evidence.malformed) failReasons.push(...evidence.reasonFailures);
  if (malformedCheckpoint) failReasons.push("malformed-checkpoint");
  if (malformedRetry) failReasons.push("malformed-retry");
  if (rawCanaryDetected) failReasons.push("raw-canary-detected");
  if (unsafeKnownValues) failReasons.push("unsafe-reason-code");

  if (failReasons.length > 0) {
    return failClosed(failReasons, counts, rawCanaryDetected);
  }

  const derived = deriveClassification(input, evidence.mode);
  const reasonCodes = evidence.reasonCodes ? uniqueReasons(evidence.reasonCodes) : uniqueReasons(derived.reasonCodes);

  return {
    gate: "review-timeout-classification",
    classification: derived.hardFailure ? "hard-failure" : "expected-bounded-outcome",
    mode: derived.mode,
    reasonCodes,
    expectedBoundedOutcome: derived.expectedBoundedOutcome,
    hardFailure: derived.hardFailure,
    counts,
    redaction: {
      rawPayloadOmitted: true,
      boundedReasonCodes: reasonCodes.length > 0 && reasonCodes.length <= MAX_REASON_CODES,
      unsafeInputOmitted: false,
      rawCanaryDetected: false,
    },
  };
}
