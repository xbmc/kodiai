import type { LearningMemoryRecord } from "../knowledge/types.ts";

export type ReviewLearningMemorySkipReason =
  | "missing-finding-id"
  | "missing-review-id"
  | "missing-repo"
  | "missing-owner"
  | "missing-finding-title"
  | "missing-file-path"
  | "invalid-severity"
  | "invalid-category"
  | "invalid-outcome"
  | "invalid-embedding-metadata";

export type ReviewLearningMemorySkipResult = {
  kind: "skip";
  gate: "learning-memory-write";
  gateResult: "skipped";
  reason: ReviewLearningMemorySkipReason;
  repo?: string;
  prNumber?: number;
  filePath?: string;
  findingTitle?: string;
};

export type ReviewLearningMemoryCandidate = {
  kind: "candidate";
  embeddingText: string;
  toRecord(embedding: ReviewLearningMemoryEmbeddingMetadata): LearningMemoryRecord | ReviewLearningMemorySkipResult;
};

export type ReviewLearningMemoryDecision = ReviewLearningMemoryCandidate | ReviewLearningMemorySkipResult;

export type ReviewLearningMemoryEmbeddingMetadata = {
  model: string | null | undefined;
  dimensions: number | null | undefined;
};

export type ReviewLearningMemoryFindingInput = {
  commentId?: number | null;
  suppressed?: boolean | null;
  title?: string | null;
  severity?: string | null;
  category?: string | null;
  filePath?: string | null;
};

export type BuildReviewLearningMemoryRecordInput = {
  finding: ReviewLearningMemoryFindingInput;
  repo?: string | null;
  owner?: string | null;
  reviewId?: number | null;
  prNumber?: number;
  language?: string | null;
};

const VALID_SEVERITIES = new Set<LearningMemoryRecord["severity"]>([
  "critical",
  "major",
  "medium",
  "minor",
]);

const VALID_CATEGORIES = new Set<LearningMemoryRecord["category"]>([
  "security",
  "correctness",
  "performance",
  "style",
  "documentation",
]);

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function skipResult(
  input: BuildReviewLearningMemoryRecordInput,
  reason: ReviewLearningMemorySkipReason,
): ReviewLearningMemorySkipResult {
  return {
    kind: "skip",
    gate: "learning-memory-write",
    gateResult: "skipped",
    reason,
    repo: input.repo ?? undefined,
    prNumber: input.prNumber,
    filePath: input.finding.filePath ?? undefined,
    findingTitle: input.finding.title ?? undefined,
  };
}

function normalizeOutcome(suppressed: boolean | null | undefined): LearningMemoryRecord["outcome"] {
  return suppressed ? "suppressed" : "accepted";
}

/**
 * Decide whether a review finding is safe to persist as learning memory.
 *
 * This helper intentionally runs before embedding generation. It validates all
 * non-embedding fields needed for a LearningMemoryRecord and returns a bounded
 * skip result for malformed or non-inlineable findings. The caller can then
 * generate an embedding only for candidates and materialize the final record
 * with embedding metadata.
 */
export function buildReviewLearningMemoryRecord(
  input: BuildReviewLearningMemoryRecordInput,
): ReviewLearningMemoryDecision {
  const { finding } = input;

  if (!isSafePositiveInteger(finding.commentId)) return skipResult(input, "missing-finding-id");
  if (!isSafePositiveInteger(input.reviewId)) return skipResult(input, "missing-review-id");
  if (!isNonEmptyString(input.repo)) return skipResult(input, "missing-repo");
  if (!isNonEmptyString(input.owner)) return skipResult(input, "missing-owner");
  if (!isNonEmptyString(finding.title)) return skipResult(input, "missing-finding-title");
  if (!isNonEmptyString(finding.filePath)) return skipResult(input, "missing-file-path");
  if (!VALID_SEVERITIES.has(finding.severity as LearningMemoryRecord["severity"])) {
    return skipResult(input, "invalid-severity");
  }
  if (!VALID_CATEGORIES.has(finding.category as LearningMemoryRecord["category"])) {
    return skipResult(input, "invalid-category");
  }

  const findingId = finding.commentId;
  const reviewId = input.reviewId;
  const repo = input.repo;
  const owner = input.owner;
  const findingText = finding.title.trim();
  const filePath = finding.filePath.trim();
  const severity = finding.severity as LearningMemoryRecord["severity"];
  const category = finding.category as LearningMemoryRecord["category"];
  const outcome = normalizeOutcome(finding.suppressed);
  const language = isNonEmptyString(input.language) ? input.language : undefined;
  const embeddingText = [
    `[${severity}] [${category}]`,
    findingText,
    `File: ${filePath}`,
  ].join("\n");

  return {
    kind: "candidate",
    embeddingText,
    toRecord(embedding: ReviewLearningMemoryEmbeddingMetadata): LearningMemoryRecord | ReviewLearningMemorySkipResult {
      if (!isNonEmptyString(embedding.model) || !isSafePositiveInteger(embedding.dimensions)) {
        return skipResult(input, "invalid-embedding-metadata");
      }

      return {
        repo,
        owner,
        findingId,
        reviewId,
        sourceRepo: repo,
        findingText,
        severity,
        category,
        filePath,
        outcome,
        embeddingModel: embedding.model,
        embeddingDim: embedding.dimensions,
        stale: false,
        language,
      };
    },
  };
}

export function isReviewLearningMemorySkip(
  decision: ReviewLearningMemoryDecision | LearningMemoryRecord | ReviewLearningMemorySkipResult,
): decision is ReviewLearningMemorySkipResult {
  return typeof decision === "object" && decision !== null && "kind" in decision && decision.kind === "skip";
}
