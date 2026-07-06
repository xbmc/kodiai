import type { ExecutionResult } from "../execution/types.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";
import type { PromptSectionRecord, TelemetryStore } from "../telemetry/types.ts";

type MentionTelemetryLogger = {
  warn: (payload: Record<string, unknown>, message: string) => void;
};

export type MentionDerivedContextCacheStatus = "hit" | "miss" | "degraded" | "bypass";
export type MentionExecutionTelemetryStage = "reuseTelemetry" | "executionTelemetry" | "promptSections";
export type MentionExecutionTelemetryWriteStatus = "recorded" | "skipped";
export type MentionExecutionTelemetrySummary = Record<
  MentionExecutionTelemetryStage,
  MentionExecutionTelemetryWriteStatus
>;
export type MentionExecutionTelemetryFailure = {
  stage: MentionExecutionTelemetryStage;
  error: Error;
};
export type MentionExecutionTelemetryResult = Result<
  MentionExecutionTelemetrySummary,
  MentionExecutionTelemetryError
>;

export class MentionExecutionTelemetryError extends Error {
  readonly failures: MentionExecutionTelemetryFailure[];

  constructor(failures: MentionExecutionTelemetryFailure[]) {
    super(`${failures.length} mention telemetry ${failures.length === 1 ? "write" : "writes"} failed`);
    this.name = "MentionExecutionTelemetryError";
    this.failures = failures;
  }
}

export async function recordMentionExecutionTelemetry(params: {
  telemetryStore: Pick<TelemetryStore, "record" | "recordRateLimitEvent" | "recordPromptSections">;
  logger: MentionTelemetryLogger;
  deliveryId: string;
  repo: string;
  prNumber?: number;
  eventType: string;
  result: ExecutionResult;
  promptSections?: PromptSectionRecord[];
  derivedContextCacheStatus: MentionDerivedContextCacheStatus;
  derivedContextCacheReason?: string;
}): Promise<MentionExecutionTelemetryResult> {
  const summary: MentionExecutionTelemetrySummary = {
    reuseTelemetry: "recorded",
    executionTelemetry: "recorded",
    promptSections: params.promptSections ? "recorded" : "skipped",
  };
  const failures: MentionExecutionTelemetryFailure[] = [];

  try {
    await params.telemetryStore.recordRateLimitEvent({
      deliveryId: params.deliveryId,
      executionIdentity: `${params.deliveryId}:reuse.mention-derived-context`,
      repo: params.repo,
      prNumber: params.prNumber,
      eventType: "reuse.mention-derived-context",
      cacheHitRate: params.derivedContextCacheStatus === "hit" ? 1 : 0,
      skippedQueries: params.derivedContextCacheStatus === "hit" ? 1 : 0,
      retryAttempts: params.derivedContextCacheStatus === "hit" ? 0 : 1,
      degradationPath: params.derivedContextCacheReason
        ? `${params.derivedContextCacheStatus}:${params.derivedContextCacheReason}`
        : params.derivedContextCacheStatus,
    });
  } catch (err) {
    const error = toError(err);
    failures.push({ stage: "reuseTelemetry", error });
    params.logger.warn({ err: error }, "Mention reuse telemetry write failed (non-blocking)");
  }

  try {
    await params.telemetryStore.record({
      deliveryId: params.deliveryId,
      repo: params.repo,
      prNumber: params.prNumber,
      eventType: params.eventType.replace(/\.$/, ""),
      model: params.result.model ?? "unknown",
      inputTokens: params.result.inputTokens,
      outputTokens: params.result.outputTokens,
      cacheReadTokens: params.result.cacheReadTokens,
      cacheCreationTokens: params.result.cacheCreationTokens,
      durationMs: params.result.durationMs,
      costUsd: params.result.costUsd,
      conclusion: params.result.conclusion,
      sessionId: params.result.sessionId,
      numTurns: params.result.numTurns,
      stopReason: params.result.stopReason,
    });
  } catch (err) {
    const error = toError(err);
    failures.push({ stage: "executionTelemetry", error });
    params.logger.warn({ err: error }, "Telemetry write failed (non-blocking)");
  }

  if (!params.promptSections) {
    return failures.length > 0 ? resultErr(new MentionExecutionTelemetryError(failures)) : resultOk(summary);
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
    params.logger.warn({ err: error }, "Prompt-section telemetry write failed (non-blocking)");
  }

  return failures.length > 0 ? resultErr(new MentionExecutionTelemetryError(failures)) : resultOk(summary);
}
