import type { ExecutionResult } from "../execution/types.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";

type ReviewTelemetryLogger = {
  warn: (payload: Record<string, unknown>, message: string) => void;
};

export type ReviewDerivedPromptCacheStatus = "hit" | "miss" | "degraded" | "bypass";

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
}): Promise<void> {
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
    params.logger.warn(
      { err },
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
    params.logger.warn({ err }, `${params.warningPrefix} telemetry write failed (non-blocking)`);
  }

  if (!params.promptSections) {
    return;
  }

  try {
    await mapWithConcurrency(
      params.promptSections,
      4,
      (promptSectionRecord) => params.telemetryStore.recordPromptSections(promptSectionRecord),
    );
  } catch (err) {
    params.logger.warn(
      { err },
      `${params.warningPrefix} prompt-section telemetry write failed (non-blocking)`,
    );
  }
}
