import type { Logger } from "pino";
import type { EmbeddingProvider, LearningMemoryRecord, LearningMemoryStore } from "../knowledge/types.ts";

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
  memoryKey: {
    repo: string;
    findingId: number;
    outcome: LearningMemoryRecord["outcome"];
  };
  embeddingText: string;
  toRecord(embedding: ReviewLearningMemoryEmbeddingMetadata): LearningMemoryRecord | ReviewLearningMemorySkipResult;
};

export type ReviewLearningMemoryDecision = ReviewLearningMemoryCandidate | ReviewLearningMemorySkipResult;

export type ReviewLearningMemoryWriteResult =
  | { status: "written" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; err?: unknown };

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

export type WriteReviewLearningMemoryInput = {
  input: BuildReviewLearningMemoryRecordInput;
  store: Pick<LearningMemoryStore, "hasMemoryConflict" | "writeMemory">;
  embeddingProvider: EmbeddingProvider;
  logger: Pick<Logger, "debug" | "info" | "warn">;
  logContext?: Record<string, unknown>;
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
    memoryKey: {
      repo,
      findingId,
      outcome,
    },
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

async function hasExistingReviewLearningMemory(
  store: Pick<LearningMemoryStore, "hasMemoryConflict">,
  decision: ReviewLearningMemoryCandidate,
): Promise<boolean> {
  return store.hasMemoryConflict(decision.memoryKey);
}

function logLearningMemorySkip(
  logger: Pick<Logger, "info">,
  logContext: Record<string, unknown> | undefined,
  skip: {
    reason: string;
    filePath?: string | null;
    findingTitle?: string | null;
  },
  message: string,
): void {
  logger.info(
    {
      ...logContext,
      gate: "learning-memory-write",
      gateResult: "skipped",
      reason: skip.reason,
      filePath: skip.filePath ?? undefined,
      findingTitle: skip.findingTitle ?? undefined,
    },
    message,
  );
}

export async function writeReviewLearningMemory(
  params: WriteReviewLearningMemoryInput,
): Promise<ReviewLearningMemoryWriteResult> {
  const { input, store, embeddingProvider, logger, logContext } = params;
  const decision = buildReviewLearningMemoryRecord(input);

  if (isReviewLearningMemorySkip(decision)) {
    logLearningMemorySkip(logger, logContext, decision, "Learning memory write skipped for finding");
    return { status: "skipped", reason: decision.reason };
  }

  try {
    let duplicateMemory = false;
    try {
      duplicateMemory = await hasExistingReviewLearningMemory(store, decision);
    } catch (err) {
      logger.debug(
        {
          ...logContext,
          gate: "learning-memory-write",
          gateResult: "preflight-unavailable",
          err,
          findingTitle: input.finding.title,
          filePath: input.finding.filePath,
        },
        "Learning memory duplicate preflight failed; continuing with embedding",
      );
    }

    if (duplicateMemory) {
      logLearningMemorySkip(
        logger,
        logContext,
        {
          reason: "duplicate-memory",
          filePath: input.finding.filePath,
          findingTitle: input.finding.title,
        },
        "Learning memory write skipped for duplicate finding",
      );
      return { status: "skipped", reason: "duplicate-memory" };
    }

    const embeddingResult = await embeddingProvider.generate(decision.embeddingText, "document");
    if (!embeddingResult) {
      return { status: "failed" };
    }

    const memoryRecord = decision.toRecord({
      model: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
    });
    if (isReviewLearningMemorySkip(memoryRecord)) {
      logLearningMemorySkip(logger, logContext, memoryRecord, "Learning memory write skipped for finding");
      return { status: "skipped", reason: memoryRecord.reason };
    }

    await store.writeMemory(memoryRecord, embeddingResult.embedding);
    return { status: "written" };
  } catch (err) {
    logger.warn(
      {
        ...logContext,
        gate: "learning-memory-write",
        gateResult: "failed",
        err,
        findingTitle: input.finding.title,
        filePath: input.finding.filePath,
      },
      "Learning memory write failed for finding (fail-open)",
    );
    return { status: "failed", err };
  }
}
