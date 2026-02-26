/**
 * Unified generateText wrapper with fallback and cost tracking.
 *
 * Wraps AI SDK generateText() with automatic fallback on 429/5xx/timeout.
 * NEVER uses streamText() (Bun production build failure: oven-sh/bun#25630).
 */

import { generateText } from "ai";
import type { Logger } from "pino";
import type { ResolvedModel } from "./task-router.ts";
import type { CostTracker } from "./cost-tracker.ts";
import { createProviderModel } from "./providers.ts";
import { isAgenticTaskType } from "./task-types.ts";
import { isFallbackTrigger, getFallbackReason } from "./fallback.ts";

/** Result from generateWithFallback. */
export interface GenerateResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
  usedFallback: boolean;
  fallbackReason?: string;
  /** Visible annotation to include in output when fallback was used. */
  fallbackAnnotation?: string;
  durationMs: number;
}

/**
 * Generate text with automatic fallback on provider failures.
 *
 * Uses AI SDK generateText() with the resolved primary model.
 * On 429/5xx/timeout, falls back to the fallback model.
 * Tracks cost via CostTracker (fire-and-forget).
 */
export async function generateWithFallback(opts: {
  taskType: string;
  resolved: ResolvedModel;
  prompt: string;
  system?: string;
  tools?: Record<string, any>;
  costTracker?: CostTracker;
  repo?: string;
  deliveryId?: string;
  logger: Logger;
}): Promise<GenerateResult> {
  const { taskType, resolved, logger } = opts;
  const startTime = Date.now();

  try {
    // Attempt with primary model
    const model = createProviderModel(resolved.modelId);
    const response = await generateText({
      model,
      prompt: opts.prompt,
      system: opts.system,
      tools: opts.tools,
    });

    const durationMs = Date.now() - startTime;
    const usage = {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    };

    // Track cost (fire-and-forget)
    if (opts.costTracker && opts.repo) {
      opts.costTracker.trackAiSdkCall({
        repo: opts.repo,
        taskType,
        model: resolved.modelId,
        provider: resolved.provider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs,
        usedFallback: false,
        deliveryId: opts.deliveryId,
      });
    }

    return {
      text: response.text,
      usage,
      model: resolved.modelId,
      provider: resolved.provider,
      usedFallback: false,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    // Check if error should trigger fallback
    if (isFallbackTrigger(err) && resolved.fallbackModelId) {
      const reason = getFallbackReason(err);
      logger.warn(
        {
          taskType,
          primaryModel: resolved.modelId,
          fallbackModel: resolved.fallbackModelId,
          reason,
        },
        "Primary model %s failed (%s), falling back to %s",
        resolved.modelId,
        reason,
        resolved.fallbackModelId,
      );

      try {
        const fallbackModel = createProviderModel(resolved.fallbackModelId);
        const fallbackStartTime = Date.now();
        const fallbackResponse = await generateText({
          model: fallbackModel,
          prompt: opts.prompt,
          system: opts.system,
          tools: opts.tools,
        });

        const fallbackDurationMs = Date.now() - fallbackStartTime;
        const usage = {
          inputTokens: fallbackResponse.usage?.inputTokens ?? 0,
          outputTokens: fallbackResponse.usage?.outputTokens ?? 0,
        };

        // Track fallback cost
        if (opts.costTracker && opts.repo) {
          opts.costTracker.trackAiSdkCall({
            repo: opts.repo,
            taskType,
            model: resolved.fallbackModelId,
            provider: resolved.fallbackProvider,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            durationMs: fallbackDurationMs,
            usedFallback: true,
            fallbackReason: reason,
            deliveryId: opts.deliveryId,
          });
        }

        const fallbackAnnotation = `> **Note:** Used fallback model \`${resolved.fallbackModelId}\` (configured provider unavailable: ${reason})`;

        return {
          text: fallbackResponse.text,
          usage,
          model: resolved.fallbackModelId,
          provider: resolved.fallbackProvider,
          usedFallback: true,
          fallbackReason: reason,
          fallbackAnnotation,
          durationMs: durationMs + fallbackDurationMs,
        };
      } catch (fallbackErr) {
        // Fallback also failed
        logger.error(
          { taskType, fallbackModel: resolved.fallbackModelId, err: fallbackErr },
          "Fallback model also failed",
        );

        // Track error cost
        if (opts.costTracker && opts.repo) {
          opts.costTracker.trackAiSdkCall({
            repo: opts.repo,
            taskType,
            model: resolved.fallbackModelId,
            provider: resolved.fallbackProvider,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: Date.now() - startTime,
            usedFallback: true,
            fallbackReason: reason,
            deliveryId: opts.deliveryId,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          });
        }

        throw fallbackErr;
      }
    }

    // Not a fallback trigger or no fallback model -- rethrow
    // Track error cost
    if (opts.costTracker && opts.repo) {
      opts.costTracker.trackAiSdkCall({
        repo: opts.repo,
        taskType,
        model: resolved.modelId,
        provider: resolved.provider,
        inputTokens: 0,
        outputTokens: 0,
        durationMs,
        usedFallback: false,
        deliveryId: opts.deliveryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    throw err;
  }
}
