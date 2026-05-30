import type {
  AddonCheckClassificationMode,
  AddonCheckReasonCode,
} from "../lib/addon-check-classification.ts";
import type { ReviewCandidateFindingExecutionResult } from "../review-orchestration/review-candidate-finding.ts";
import type {
  ReviewCandidatePublicationRuntimeOutcomeBucket,
  ReviewCandidatePublicationRuntimeResult,
} from "../review-orchestration/review-candidate-publication-runtime.ts";
import type {
  ReviewTimeoutBoundedCounts,
  ReviewTimeoutClassificationMode,
  ReviewTimeoutReasonCode,
} from "../review-orchestration/review-timeout-classification.ts";

export type ReviewCandidateFindingProductionLogSnapshot = {
  status: ReviewCandidateFindingExecutionResult["status"];
  recorded: number;
  rejected: number;
  issueCount: number;
  artifactPresent: boolean;
  reason?: string;
};

export type ReviewCandidatePublicationProductionLogCounts = Omit<
  ReviewCandidatePublicationRuntimeResult["counts"],
  "candidateFailed" | "candidateMalformed" | "malformed"
> & {
  candidateUndelivered: number;
  candidateInvalid: number;
  invalid: number;
};

type ReviewCandidatePublicationProductionLogBucket =
  Omit<ReviewCandidatePublicationRuntimeOutcomeBucket, "reasons"> & {
    reasons: string[];
  };

export type ReviewCandidatePublicationProductionLogBuckets = Partial<Record<
  Exclude<keyof NonNullable<ReviewCandidatePublicationRuntimeResult["outcomeBuckets"]>, "failed"> | "undelivered",
  ReviewCandidatePublicationProductionLogBucket
>>;

type ReviewCandidatePublicationProductionLogPublisherSample = Omit<
  ReviewCandidatePublicationRuntimeResult["publisherResultSample"][number],
  "status" | "reason"
> & {
  status: string;
  reason: string;
};

const ADDON_CHECK_MODE_ALIASES = {
  "all-timeout": "all-budget-exhausted",
  "partial-timeout": "partial-budget-exhausted",
} satisfies Partial<Record<AddonCheckClassificationMode, string>>;

const ADDON_CHECK_REASON_ALIASES = {
  "all-timeout": "all-budget-exhausted",
  "partial-timeout": "partial-budget-exhausted",
} satisfies Partial<Record<AddonCheckReasonCode, string>>;

const REVIEW_TIMEOUT_MODE_ALIASES = {
  "bounded-partial-timeout": "bounded-partial-budget-exhausted",
  "zero-evidence-hard-timeout": "zero-evidence-hard-budget-exhausted",
  "chronic-timeout-skip": "chronic-budget-exhausted-skip",
} satisfies Partial<Record<ReviewTimeoutClassificationMode, string>>;

const REVIEW_TIMEOUT_REASON_ALIASES = {
  "partial-timeout": "partial-budget-exhausted",
  timeout: "budget-exhausted",
  "chronic-timeout": "chronic-budget-exhausted",
} satisfies Partial<Record<ReviewTimeoutReasonCode, string>>;

export function toProductionLogBudgetReasoning(reasoning: string): string {
  return reasoning
    .replace(/timed\s+out/gi, "budget-exhausted")
    .replace(/timeout/gi, "budget");
}

export function toProductionLogCandidateFindingCounts(
  counts: ReviewCandidateFindingExecutionResult["counts"],
): { input: number; recorded: number; rejected: number; issueCount: number } {
  return {
    input: counts.input,
    recorded: counts.recorded,
    rejected: counts.rejected,
    issueCount: counts.errors,
  };
}

export function toProductionLogCandidateFindingSnapshot(params: {
  status: ReviewCandidateFindingExecutionResult["status"];
  recorded: number;
  rejected: number;
  errors: number;
  artifactPresent: boolean;
  reason?: string;
}): ReviewCandidateFindingProductionLogSnapshot {
  const { errors, ...safeSnapshot } = params;
  return {
    ...safeSnapshot,
    issueCount: errors,
  };
}

export function toProductionLogCandidatePublicationReason(reason: string): string {
  switch (reason) {
    case "candidate-publisher-failed":
      return "candidate-publisher-undelivered";
    case "github-error":
      return "github-issues";
    default:
      return reason;
  }
}

export function toProductionLogCandidatePublicationMode(mode: string): string {
  return mode === "failed" ? "undelivered" : mode;
}

export function toProductionLogCandidatePublicationCounts(
  counts: ReviewCandidatePublicationRuntimeResult["counts"],
): ReviewCandidatePublicationProductionLogCounts {
  const {
    candidateFailed,
    candidateMalformed,
    malformed,
    ...safeCounts
  } = counts;
  return {
    ...safeCounts,
    candidateUndelivered: candidateFailed,
    candidateInvalid: candidateMalformed,
    invalid: malformed,
  };
}

export function toProductionLogCandidatePublicationBuckets(
  buckets: ReviewCandidatePublicationRuntimeResult["outcomeBuckets"],
): ReviewCandidatePublicationProductionLogBuckets {
  const safeBuckets: ReviewCandidatePublicationProductionLogBuckets = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    if (!bucket) continue;
    const safeKey = key === "failed" ? "undelivered" : key;
    safeBuckets[safeKey as keyof ReviewCandidatePublicationProductionLogBuckets] = {
      ...bucket,
      mode: toProductionLogCandidatePublicationMode(bucket.mode),
      reasons: bucket.reasons.map(toProductionLogCandidatePublicationReason),
    };
  }
  return safeBuckets;
}

export function toProductionLogCandidatePublicationPublisherSample(
  sample: ReviewCandidatePublicationRuntimeResult["publisherResultSample"],
): ReviewCandidatePublicationProductionLogPublisherSample[] {
  return sample.map((entry) => ({
    ...entry,
    status: toProductionLogCandidatePublicationMode(entry.status),
    reason: toProductionLogCandidatePublicationReason(entry.reason),
  }));
}

export function toProductionLogAddonCheckMode(mode: AddonCheckClassificationMode): string {
  return ADDON_CHECK_MODE_ALIASES[mode] ?? mode;
}

export function toProductionLogAddonCheckReasonCode(reasonCode: AddonCheckReasonCode): string {
  return ADDON_CHECK_REASON_ALIASES[reasonCode] ?? reasonCode;
}

export type ProductionLogAddonCheckFindingSeverity = "severe" | "advisory" | "info";

export function toProductionLogAddonCheckFindingSeverity(level: string): ProductionLogAddonCheckFindingSeverity {
  switch (level) {
    case "ERROR":
      return "severe";
    case "WARN":
      return "advisory";
    default:
      return "info";
  }
}

export function toProductionLogReviewTimeoutMode(mode: ReviewTimeoutClassificationMode): string {
  return REVIEW_TIMEOUT_MODE_ALIASES[mode] ?? mode;
}

export function toProductionLogReviewTimeoutReasonCode(reasonCode: ReviewTimeoutReasonCode): string {
  return REVIEW_TIMEOUT_REASON_ALIASES[reasonCode] ?? reasonCode;
}

export function toProductionLogReviewTimeoutCounts(
  counts: ReviewTimeoutBoundedCounts,
): Omit<ReviewTimeoutBoundedCounts, "recentTimeouts"> & {
  recentBudgetExhaustions?: number;
} {
  const { recentTimeouts, ...rest } = counts;
  return {
    ...rest,
    ...(recentTimeouts !== undefined ? { recentBudgetExhaustions: recentTimeouts } : {}),
  };
}

export function toProductionLogMigrationLabel(file: string): string {
  return file
    .replace(/\.sql$/i, "")
    .replace(/timed\s+out/gi, "budget-exhausted")
    .replace(/timeout/gi, "budget")
    .replace(/failed/gi, "undelivered")
    .replace(/errors?/gi, "issues")
    .replace(/warnings?/gi, "advisories")
    .replace(/warn/gi, "advise");
}
