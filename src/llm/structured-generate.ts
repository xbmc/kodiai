import type {
  ModelUsage,
  SDKResultMessage,
  query as agentSdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import { buildAgentEnv } from "../execution/env.ts";
import { createAbortControllerWithTimeout } from "../lib/with-timeout.ts";
import type { CostTracker } from "./cost-tracker.ts";
import type { ResolvedModel } from "./task-router.ts";

const STRUCTURED_GENERATE_TIMEOUT_MS = 120_000;

type AgentSdkQuery = typeof agentSdkQuery;
type AgentSdkLoader = () => Promise<AgentSdkQuery>;

export type StructuredFailureKind =
  | "timeout"
  | "cancelled"
  | "provider"
  | "transport"
  | "unsuccessful-result"
  | "missing-structured-output"
  | "validation";

export class StructuredGenerationError extends Error {
  constructor(
    public readonly kind: StructuredFailureKind,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StructuredGenerationError";
  }
}

export type StructuredGenerateOptions<T> = {
  taskType: string;
  resolved: ResolvedModel;
  prompt: string;
  system: string;
  schema: Record<string, unknown>;
  validate: (output: unknown) => T;
  logger: Logger;
  costTracker?: CostTracker;
  repo?: string;
  deliveryId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  loadQuery?: AgentSdkLoader;
};

export type StructuredGenerateResult<T> = {
  output: T;
  model: string;
  provider: "anthropic";
  usedFallback: boolean;
  fallbackReason?: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

function sumModelUsage(modelUsage: Record<string, ModelUsage>): UsageTotals {
  return Object.values(modelUsage).reduce<UsageTotals>(
    (totals, usage) => ({
      inputTokens: totals.inputTokens + usage.inputTokens,
      outputTokens: totals.outputTokens + usage.outputTokens,
      cacheReadTokens: totals.cacheReadTokens + usage.cacheReadInputTokens,
      cacheWriteTokens: totals.cacheWriteTokens + usage.cacheCreationInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

function normalizeStructuredError(error: unknown): StructuredGenerationError {
  if (error instanceof StructuredGenerationError) return error;

  const status = typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : undefined;
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new StructuredGenerationError(
      "provider",
      "Claude Agent SDK provider request failed",
      true,
      { cause: error },
    );
  }

  return new StructuredGenerationError(
    "transport",
    "Claude Agent SDK structured generate failed",
    true,
    { cause: error },
  );
}

async function defaultLoadQuery(): Promise<AgentSdkQuery> {
  return (await import("@anthropic-ai/claude-agent-sdk")).query;
}

async function runStructuredAgentAttempt<T>(
  options: StructuredGenerateOptions<T>,
  model: string,
  usedFallback: boolean,
  fallbackReason?: StructuredFailureKind,
): Promise<StructuredGenerateResult<T>> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? STRUCTURED_GENERATE_TIMEOUT_MS;
  const deadline = createAbortControllerWithTimeout(
    "Claude Agent SDK structured generate",
    timeoutMs,
  );
  let externallyCancelled = false;
  let resultMessage: SDKResultMessage | undefined;
  let completionCategory: StructuredFailureKind | "success" = "transport";
  const onExternalAbort = () => {
    externallyCancelled = true;
    deadline.controller.abort(options.signal?.reason);
  };

  if (options.signal?.aborted) {
    onExternalAbort();
  } else {
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const query = await (options.loadQuery ?? defaultLoadQuery)();
    const sdkQuery = query({
      prompt: options.prompt,
      options: {
        abortController: deadline.controller,
        cwd: process.cwd(),
        model,
        maxTurns: 3,
        systemPrompt: options.system,
        allowedTools: [],
        disallowedTools: [],
        outputFormat: { type: "json_schema", schema: options.schema },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        env: {
          ...buildAgentEnv(),
          CLAUDE_CODE_ENTRYPOINT: "kodiai-llm-structured-generate",
        },
      },
    });

    for await (const message of sdkQuery) {
      if (message.type === "result") resultMessage = message;
    }

    if (deadline.controller.signal.aborted) {
      throw deadline.controller.signal.reason;
    }
    if (!resultMessage) {
      throw new StructuredGenerationError(
        "missing-structured-output",
        "Claude Agent SDK returned no structured output",
        true,
      );
    }
    const usage = sumModelUsage(resultMessage.modelUsage);
    const resolvedModel = Object.keys(resultMessage.modelUsage)[0] ?? model;
    const durationMs = resultMessage.duration_ms ?? Date.now() - startedAt;
    if (options.costTracker && options.repo) {
      void options.costTracker.trackAgentSdkCall({
        repo: options.repo,
        taskType: options.taskType,
        model: resolvedModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        durationMs,
        costUsd: resultMessage.total_cost_usd,
        deliveryId: options.deliveryId,
      });
    }
    if (resultMessage.subtype !== "success") {
      throw new StructuredGenerationError(
        "unsuccessful-result",
        "Claude Agent SDK did not return success",
        true,
      );
    }
    if (!("structured_output" in resultMessage) || resultMessage.structured_output === undefined) {
      throw new StructuredGenerationError(
        "missing-structured-output",
        "Claude Agent SDK returned no structured output",
        true,
      );
    }

    let output: T;
    try {
      output = options.validate(resultMessage.structured_output);
    } catch (error) {
      throw new StructuredGenerationError(
        "validation",
        "Structured output failed domain validation",
        true,
        { cause: error },
      );
    }

    completionCategory = "success";
    return {
      output,
      model: resolvedModel,
      provider: "anthropic",
      usedFallback,
      ...(fallbackReason ? { fallbackReason } : {}),
      durationMs,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    };
  } catch (error) {
    let normalized: StructuredGenerationError;
    if (deadline.controller.signal.aborted) {
      normalized = externallyCancelled
        ? new StructuredGenerationError(
          "cancelled",
          "Claude Agent SDK structured generate was cancelled",
          false,
          { cause: error ?? deadline.controller.signal.reason },
        )
        : new StructuredGenerationError(
          "timeout",
          `Claude Agent SDK structured generate timed out after ${timeoutMs}ms`,
          true,
          { cause: error ?? deadline.controller.signal.reason },
        );
    } else {
      normalized = normalizeStructuredError(error);
    }
    completionCategory = normalized.kind;
    throw normalized;
  } finally {
    options.signal?.removeEventListener("abort", onExternalAbort);
    deadline.clear();
    const durationMs = resultMessage?.duration_ms ?? Date.now() - startedAt;
    const resolvedModel = Object.keys(resultMessage?.modelUsage ?? {})[0] ?? model;
    options.logger.info(
      {
        taskType: options.taskType,
        requestedModel: model,
        resolvedModel,
        attempt: usedFallback ? 2 : 1,
        durationMs,
        completionCategory,
        promptCharacterCount: options.prompt.length,
      },
      "Claude Agent SDK structured generation attempt completed",
    );
  }
}

export async function generateStructuredWithFallback<T>(
  options: StructuredGenerateOptions<T>,
): Promise<StructuredGenerateResult<T>> {
  const attempts = [
    { model: options.resolved.modelId, usedFallback: false },
    { model: options.resolved.fallbackModelId, usedFallback: true },
  ];

  let primaryFailure: StructuredGenerationError | undefined;
  for (const [index, attempt] of attempts.entries()) {
    if (index === 1 && (!primaryFailure?.retryable || !attempt.model)) break;
    try {
      return await runStructuredAgentAttempt(
        options,
        attempt.model,
        attempt.usedFallback,
        primaryFailure?.kind,
      );
    } catch (error) {
      const normalized = normalizeStructuredError(error);
      if (index === 1 || !normalized.retryable) throw normalized;
      primaryFailure = normalized;
    }
  }
  throw primaryFailure ?? new StructuredGenerationError(
    "transport",
    "No structured model attempt was available",
    false,
  );
}
