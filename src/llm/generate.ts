/**
 * Unified generateText wrapper with fallback and cost tracking.
 *
 * Wraps AI SDK generateText() with automatic fallback on 429/5xx/timeout.
 * NEVER uses streamText() (Bun production build failure: oven-sh/bun#25630).
 */

import { generateText } from "ai";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import type { ResolvedModel } from "./task-router.ts";
import type { CostTracker } from "./cost-tracker.ts";
import { createProviderModel } from "./providers.ts";
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

function shouldUseAgentSdk(resolved: ResolvedModel): boolean {
  if (resolved.sdk === "agent") return true;
  return resolved.provider === "anthropic"
    && !process.env.ANTHROPIC_API_KEY
    && !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

async function generateWithAgentSdk(opts: {
  taskType: string;
  resolved: ResolvedModel;
  prompt: string;
  system?: string;
  costTracker?: CostTracker;
  repo?: string;
  deliveryId?: string;
  logger: Logger;
}): Promise<GenerateResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const modelId = opts.resolved.modelId.includes("haiku")
    ? opts.resolved.fallbackModelId
    : opts.resolved.modelId;
  const sdkQuery = query({
    prompt: opts.prompt,
    options: {
      abortController: controller,
      cwd: process.cwd(),
      model: modelId,
      maxTurns: 1,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        ...(opts.system ? { append: opts.system } : {}),
      },
      allowedTools: [],
      disallowedTools: [],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: "kodiai-llm-generate",
      },
    },
  });

  let resultMessage: SDKResultMessage | undefined;
  let lastAssistantText = "";
  for await (const message of sdkQuery) {
    if (message.type === "assistant") {
      const parts = (message.message?.content ?? []) as Array<{ type?: string; text?: string }>;
      const text = parts
        .filter((part: { type?: string; text?: string }) => part.type === "text")
        .map((part: { type?: string; text?: string }) => part.text ?? "")
        .join("");
      if (text.trim().length > 0) {
        lastAssistantText = text;
      }
    }
    if (message.type === "result") {
      resultMessage = message as SDKResultMessage;
    }
  }

  const durationMs = Date.now() - startTime;
  if ((!resultMessage || resultMessage.subtype !== "success") && lastAssistantText.trim().length === 0) {
    const errorText = resultMessage && "result" in resultMessage
      ? String(resultMessage.result)
      : "No successful result message received from Claude Agent SDK";
    throw new Error(errorText);
  }

  const modelEntries = Object.entries(resultMessage?.modelUsage ?? {});
  const primaryModel = modelEntries[0]?.[0] ?? modelId;
  const totalInput = modelEntries.reduce((sum, [, u]) => sum + u.inputTokens, 0);
  const totalOutput = modelEntries.reduce((sum, [, u]) => sum + u.outputTokens, 0);
  const totalCacheRead = modelEntries.reduce((sum, [, u]) => sum + u.cacheReadInputTokens, 0);
  const totalCacheCreation = modelEntries.reduce((sum, [, u]) => sum + u.cacheCreationInputTokens, 0);

  if (opts.costTracker && opts.repo && resultMessage) {
    opts.costTracker.trackAgentSdkCall({
      repo: opts.repo,
      taskType: opts.taskType,
      model: primaryModel,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheCreation,
      durationMs: resultMessage.duration_ms ?? durationMs,
      costUsd: resultMessage.total_cost_usd,
      deliveryId: opts.deliveryId,
    });
  }

  const finalText = resultMessage && "result" in resultMessage
    ? String(resultMessage.result)
    : lastAssistantText;

  return {
    text: finalText,
    usage: { inputTokens: totalInput, outputTokens: totalOutput },
    model: primaryModel,
    provider: "anthropic",
    usedFallback: false,
    durationMs: resultMessage?.duration_ms ?? durationMs,
  };
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
    // Attempt with primary model using the appropriate SDK.
    if (shouldUseAgentSdk(resolved)) {
      return await generateWithAgentSdk(opts);
    }

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
