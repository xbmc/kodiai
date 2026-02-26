/**
 * Cost tracking module for logging LLM invocations.
 *
 * Wraps cost estimation + telemetry store recording into a
 * convenient fire-and-forget interface. Never throws.
 */

import type { Logger } from "pino";
import type { TelemetryStore, LlmCostRecord } from "../telemetry/types.ts";
import { estimateCost } from "./pricing.ts";
import { extractProvider } from "./providers.ts";

export type { LlmCostRecord };

/** Cost tracker for recording LLM invocation costs. */
export type CostTracker = {
  /**
   * Track an AI SDK generateText() call.
   * Computes cost from pricing config and records to telemetry store.
   * Fire-and-forget: never throws.
   */
  trackAiSdkCall(params: {
    repo: string;
    taskType: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    durationMs: number;
    usedFallback: boolean;
    fallbackReason?: string;
    deliveryId?: string;
    error?: string;
  }): Promise<void>;

  /**
   * Track an Agent SDK query() call.
   * Uses provided costUsd when available, otherwise computes from pricing config.
   * Fire-and-forget: never throws.
   */
  trackAgentSdkCall(params: {
    repo: string;
    taskType: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    durationMs: number;
    costUsd?: number;
    deliveryId?: string;
    error?: string;
  }): Promise<void>;
};

/**
 * Creates a CostTracker instance that records LLM invocation costs.
 *
 * Both methods are fire-and-forget -- they never throw.
 * All errors are caught and logged as warnings (fail-open).
 */
export function createCostTracker(deps: {
  telemetryStore: TelemetryStore;
  logger: Logger;
}): CostTracker {
  const { telemetryStore, logger } = deps;

  return {
    async trackAiSdkCall(params): Promise<void> {
      try {
        const estimatedCostUsd = estimateCost(
          params.model,
          params.inputTokens,
          params.outputTokens,
        );

        const record: LlmCostRecord = {
          deliveryId: params.deliveryId,
          repo: params.repo,
          taskType: params.taskType,
          model: params.model,
          provider: params.provider,
          sdk: "ai",
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          cacheReadTokens: params.cacheReadTokens,
          cacheWriteTokens: params.cacheWriteTokens,
          estimatedCostUsd,
          durationMs: params.durationMs,
          usedFallback: params.usedFallback,
          fallbackReason: params.fallbackReason,
          error: params.error,
        };

        await telemetryStore.recordLlmCost(record);
      } catch (err) {
        logger.warn(
          { err, model: params.model, taskType: params.taskType },
          "Failed to track AI SDK cost",
        );
      }
    },

    async trackAgentSdkCall(params): Promise<void> {
      try {
        const provider = extractProvider(params.model);
        const estimatedCostUsd =
          params.costUsd ??
          estimateCost(params.model, params.inputTokens, params.outputTokens);

        const record: LlmCostRecord = {
          deliveryId: params.deliveryId,
          repo: params.repo,
          taskType: params.taskType,
          model: params.model,
          provider,
          sdk: "agent",
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          cacheReadTokens: params.cacheReadTokens,
          cacheWriteTokens: params.cacheWriteTokens,
          estimatedCostUsd,
          durationMs: params.durationMs,
          usedFallback: false,
          error: params.error,
        };

        await telemetryStore.recordLlmCost(record);
      } catch (err) {
        logger.warn(
          { err, model: params.model, taskType: params.taskType },
          "Failed to track Agent SDK cost",
        );
      }
    },
  };
}
