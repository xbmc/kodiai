import type { ExecutionResult } from "../execution/types.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";

type ReviewTelemetryLogger = {
  warn: (payload: Record<string, unknown>, message: string) => void;
};

export type ReviewDerivedPromptCacheStatus = "hit" | "miss" | "degraded" | "bypass";
export type ReviewExecutionTelemetryStage = "reuseTelemetry" | "executionTelemetry" | "promptSections";
export type ReviewExecutionTelemetryWriteStatus = "recorded" | "skipped";
export type ReviewExecutionTelemetrySummary = Record<
  ReviewExecutionTelemetryStage,
  ReviewExecutionTelemetryWriteStatus
>;
export type ReviewExecutionTelemetryFailure = {
  stage: ReviewExecutionTelemetryStage;
  error: Error;
};
export type ReviewExecutionTelemetryResult = Result<
  ReviewExecutionTelemetrySummary,
  ReviewExecutionTelemetryError
>;

export class ReviewExecutionTelemetryError extends Error {
  readonly failures: ReviewExecutionTelemetryFailure[];

  constructor(failures: ReviewExecutionTelemetryFailure[]) {
    super(`${failures.length} review telemetry ${failures.length === 1 ? "write" : "writes"} failed`);
    this.name = "ReviewExecutionTelemetryError";
    this.failures = failures;
  }
}

function resolveReviewTelemetryConclusion(result: ExecutionResult): string {
  if (result.isTimeout && result.published) {
    return "timeout_partial";
  }
  if (result.isTimeout) {
    return "timeout";
  }
  return result.conclusion;
}

export async function recordReviewExecutionTelemetry(params: {
  telemetryStore: Pick<TelemetryStore, "record" | "recordRateLimitEvent" | "recordPromptSections">;
  logger: ReviewTelemetryLogger;
  deliveryId: string;
  repo: string;
  prNumber: number;
  prAuthor: string;
  eventType: string;
  result: ExecutionResult;
  promptSections?: PromptSectionRecord[];
  derivedPromptCacheStatus: ReviewDerivedPromptCacheStatus;
  derivedPromptCacheReason?: string;
  warningPrefix: "Review" | "Retry";
}): Promise<ReviewExecutionTelemetryResult> {
  const summary: ReviewExecutionTelemetrySummary = {
    reuseTelemetry: "recorded",
    executionTelemetry: "recorded",
    promptSections: params.promptSections ? "recorded" : "skipped",
  };
  const failures: ReviewExecutionTelemetryFailure[] = [];

  try {
    await params.telemetryStore.recordRateLimitEvent({
      deliveryId: params.deliveryId,
      executionIdentity: `${params.deliveryId}:reuse.review-derived-prompt`,
      repo: params.repo,
      prNumber: params.prNumber,
      eventType: "reuse.review-derived-prompt",
      cacheHitRate: params.derivedPromptCacheStatus === "hit" ? 1 : 0,
      skippedQueries: params.derivedPromptCacheStatus === "hit" ? 1 : 0,
      retryAttempts: params.derivedPromptCacheStatus === "hit" ? 0 : 1,
      degradationPath: params.derivedPromptCacheReason
        ? `${params.derivedPromptCacheStatus}:${params.derivedPromptCacheReason}`
        : params.derivedPromptCacheStatus,
    });
  } catch (err) {
    const error = toError(err);
    failures.push({ stage: "reuseTelemetry", error });
    params.logger.warn(
      { err: error },
      `${params.warningPrefix} derived-prompt reuse telemetry write failed (non-blocking)`,
    );
  }

  try {
    await params.telemetryStore.record({
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      prAuthor: params.prAuthor,
      eventType: params.eventType,
      model: params.result.model ?? "unknown",
      inputTokens: params.result.inputTokens,
      outputTokens: params.result.outputTokens,
      cacheReadTokens: params.result.cacheReadTokens,
      cacheCreationTokens: params.result.cacheCreationTokens,
      durationMs: params.result.durationMs,
      costUsd: params.result.costUsd,
      conclusion: resolveReviewTelemetryConclusion(params.result),
      sessionId: params.result.sessionId,
      numTurns: params.result.numTurns,
      stopReason: params.result.stopReason,
    });
  } catch (err) {
    const error = toError(err);
    failures.push({ stage: "executionTelemetry", error });
    params.logger.warn({ err: error }, `${params.warningPrefix} telemetry write failed (non-blocking)`);
  }

  if (!params.promptSections) {
    return failures.length > 0 ? resultErr(new ReviewExecutionTelemetryError(failures)) : resultOk(summary);
  }

  try {
    await mapWithConcurrency(
      params.promptSections,
      4,
      (promptSectionRecord) => params.telemetryStore.recordPromptSections(promptSectionRecord),
    );
  } catch (err) {
    const error = toError(err);
    failures.push({ stage: "promptSections", error });
    params.logger.warn(
      { err: error },
      `${params.warningPrefix} prompt-section telemetry write failed (non-blocking)`,
    );
  }

  return failures.length > 0 ? resultErr(new ReviewExecutionTelemetryError(failures)) : resultOk(summary);
}
