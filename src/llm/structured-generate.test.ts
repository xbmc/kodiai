import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { TASK_TYPES } from "./task-types.ts";
import { createTaskRouter } from "./task-router.ts";
import {
  generateStructuredWithFallback,
  StructuredGenerationError,
} from "./structured-generate.ts";

type ReviewOutput = { summary: string; findings: unknown[] };

function createLogger() {
  return {
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
  } as unknown as Logger;
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
    resolved: createTaskRouter({ models: {} }).resolve(TASK_TYPES.GUARDRAIL_CLASSIFICATION),
    prompt: "bounded prompt",
    system: "Kodi add-on submission-rule classifier. Use only supplied evidence.",
    schema: { type: "object", required: ["summary", "findings"] },
    validate: (value: unknown) => value as ReviewOutput,
    logger: createLogger(),
    ...overrides,
  };
}

function successResult(structuredOutput: unknown, modelUsage: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    structured_output: structuredOutput,
    modelUsage,
    duration_ms: 12,
    total_cost_usd: 0,
  };
}

describe("generateStructuredWithFallback", () => {
  test("configures a bounded tool-free structured query and returns validated output", async () => {
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const query = ((input: { prompt: string; options: Record<string, unknown> }) => {
      calls.push(input);
      return (async function* () {
        yield successResult({ summary: "Reviewed.", findings: [] });
      })();
    }) as never;

    const result = await generateStructuredWithFallback({
      ...baseOptions(),
      loadQuery: async () => query,
    });

    expect(result).toMatchObject({
      output: { summary: "Reviewed.", findings: [] },
      model: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      usedFallback: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(calls[0]?.prompt).toBe("bounded prompt");
    expect(calls[0]?.options).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      maxTurns: 3,
      systemPrompt: "Kodi add-on submission-rule classifier. Use only supplied evidence.",
      allowedTools: [],
      disallowedTools: [],
      outputFormat: { type: "json_schema", schema: expect.any(Object) },
    });
    expect(calls[0]?.options.systemPrompt).not.toEqual(
      expect.objectContaining({ preset: "claude_code" }),
    );
  });

  test("rejects partial assistant prose when no successful result arrives", async () => {
    const query = (() => (async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
    })()) as never;

    await expect(generateStructuredWithFallback({
      ...baseOptions({ resolved: { ...baseOptions().resolved, fallbackModelId: "" } }),
      loadQuery: async () => query,
    })).rejects.toMatchObject({ kind: "missing-structured-output", retryable: true });
  });

  test("classifies an SDK user abort caused by the owned deadline as timeout", async () => {
    const query = ((input: { options: { abortController: AbortController } }) =>
      (async function* () {
        await new Promise<void>((_resolve, reject) => {
          input.options.abortController.signal.addEventListener(
            "abort",
            () => reject(new Error("Claude Code process aborted by user")),
            { once: true },
          );
        });
        yield undefined;
      })()) as never;

    await expect(generateStructuredWithFallback({
      ...baseOptions({
        resolved: { ...baseOptions().resolved, fallbackModelId: "" },
        timeoutMs: 5,
      }),
      loadQuery: async () => query,
    })).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });

  test("retries one validation failure on Sonnet through the same loader", async () => {
    const capturedModels: string[] = [];
    const trackAgentSdkCall = mock(() => Promise.resolve());
    let loadCount = 0;
    const query = ((input: { options: { model: string } }) => {
      capturedModels.push(input.options.model);
      return (async function* () {
        yield successResult(
          { summary: "Reviewed.", findings: [] },
          {
            [input.options.model]: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          },
        );
      })();
    }) as never;
    let validationCount = 0;

    const result = await generateStructuredWithFallback({
      ...baseOptions({
        repo: "xbmc/repo-plugins",
        costTracker: { trackAgentSdkCall } as never,
        validate: (value: unknown) => {
          validationCount++;
          if (validationCount === 1) throw new Error("invalid primary output");
          return value as ReviewOutput;
        },
      }),
      loadQuery: async () => {
        loadCount++;
        return query;
      },
    });

    expect(capturedModels).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5-20250929",
    ]);
    expect(loadCount).toBe(2);
    expect(trackAgentSdkCall).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      usedFallback: true,
      fallbackReason: "validation",
      model: "claude-sonnet-4-5-20250929",
    });
  });

  test("does not retry external cancellation", async () => {
    const models: string[] = [];
    const external = new AbortController();
    const query = ((input: { options: { model: string; abortController: AbortController } }) => {
      models.push(input.options.model);
      return (async function* () {
        external.abort(new Error("caller stopped"));
        await new Promise<void>((_resolve, reject) => {
          if (input.options.abortController.signal.aborted) {
            reject(new Error("Claude Code process aborted by user"));
          }
        });
      })();
    }) as never;

    await expect(generateStructuredWithFallback({
      ...baseOptions({ signal: external.signal }),
      loadQuery: async () => query,
    })).rejects.toMatchObject({ kind: "cancelled", retryable: false });
    expect(models).toEqual(["claude-haiku-4-5-20251001"]);
  });

  test("rejects unsuccessful results and successful results without structured output", async () => {
    for (const [message, kind] of [
      [{ type: "result", subtype: "error_max_turns", modelUsage: {}, duration_ms: 1 }, "unsuccessful-result"],
      [{ type: "result", subtype: "success", modelUsage: {}, duration_ms: 1 }, "missing-structured-output"],
    ] as const) {
      const query = (() => (async function* () { yield message; })()) as never;
      await expect(generateStructuredWithFallback({
        ...baseOptions({ resolved: { ...baseOptions().resolved, fallbackModelId: "" } }),
        loadQuery: async () => query,
      })).rejects.toMatchObject({ kind, retryable: true });
    }
  });

  test("normalizes provider failures as retryable and unknown failures as transport failures", async () => {
    const providerQuery = (() => { throw new StructuredGenerationError("provider", "rate limit", true); }) as never;
    await expect(generateStructuredWithFallback({
      ...baseOptions({ resolved: { ...baseOptions().resolved, fallbackModelId: "" } }),
      loadQuery: async () => providerQuery,
    })).rejects.toMatchObject({ kind: "provider", retryable: true });

    await expect(generateStructuredWithFallback({
      ...baseOptions({ resolved: { ...baseOptions().resolved, fallbackModelId: "" } }),
      loadQuery: async () => { throw new Error("load failed"); },
    })).rejects.toMatchObject({ kind: "transport", retryable: true });
  });

  test("tracks token usage and logs only bounded attempt metadata", async () => {
    const logger = createLogger();
    const trackAgentSdkCall = mock(() => Promise.resolve());
    const query = (() => (async function* () {
      yield successResult(
        { summary: "secret output", findings: [] },
        {
          "claude-haiku-4-5-20251001": {
            inputTokens: 10,
            outputTokens: 4,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 2,
          },
        },
      );
    })()) as never;

    const result = await generateStructuredWithFallback({
      ...baseOptions({
        logger,
        repo: "xbmc/repo-plugins",
        deliveryId: "delivery",
        costTracker: { trackAgentSdkCall } as never,
        prompt: "secret prompt",
      }),
      loadQuery: async () => query,
    });

    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(trackAgentSdkCall).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-4-5-20251001",
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    }));
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      requestedModel: "claude-haiku-4-5-20251001",
      resolvedModel: "claude-haiku-4-5-20251001",
      attempt: 1,
      durationMs: expect.any(Number),
      completionCategory: "success",
      promptCharacterCount: 13,
    }, "Claude Agent SDK structured generation attempt completed");
    const serializedLogs = JSON.stringify((logger.info as ReturnType<typeof mock>).mock.calls);
    expect(serializedLogs).not.toContain("secret prompt");
    expect(serializedLogs).not.toContain("secret output");
  });
});
