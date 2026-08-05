import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
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
      cwd: tmpdir(),
      model: "claude-haiku-4-5-20251001",
      maxTurns: 3,
      systemPrompt: "Kodi add-on submission-rule classifier. Use only supplied evidence.",
      tools: [],
      allowedTools: [],
      disallowedTools: [],
      persistSession: false,
      outputFormat: { type: "json_schema", schema: expect.any(Object) },
    });
    expect(calls[0]?.options).not.toHaveProperty("permissionMode");
    expect(calls[0]?.options).not.toHaveProperty("allowDangerouslySkipPermissions");
    expect(calls[0]?.options.systemPrompt).not.toEqual(
      expect.objectContaining({ preset: "claude_code" }),
    );
  });

  test("retains OAuth while omitting the Anthropic API key from the structured subprocess", async () => {
    const previousOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-secret";
    process.env.ANTHROPIC_API_KEY = "api-secret";
    try {
      let capturedEnv: NodeJS.ProcessEnv | undefined;
      const query = ((input: { options: { env: NodeJS.ProcessEnv } }) => {
        capturedEnv = input.options.env;
        return (async function* () {
          yield successResult({ summary: "Reviewed.", findings: [] });
        })();
      }) as never;

      await generateStructuredWithFallback({
        ...baseOptions(),
        loadQuery: async () => query,
      });

      expect(capturedEnv).toMatchObject({
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
        CLAUDE_CODE_ENTRYPOINT: "kodiai-llm-structured-generate",
      });
      expect(capturedEnv).not.toHaveProperty("ANTHROPIC_API_KEY");
    } finally {
      if (previousOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOauth;
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
  });

  test("rejects assistant and tool-like events when no successful structured result arrives", async () => {
    const query = (() => (async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
      yield { type: "tool", name: "Read", result: { summary: "forged", findings: [] } };
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

  test("keeps timeout ownership when the caller signal aborts from the deadline handler", async () => {
    const external = new AbortController();
    const query = ((input: { options: { abortController: AbortController } }) =>
      (async function* () {
        await new Promise<void>((_resolve, reject) => {
          input.options.abortController.signal.addEventListener(
            "abort",
            () => {
              external.abort(new Error("caller observed deadline"));
              reject(new Error("Claude Code process aborted by user"));
            },
            { once: true },
          );
        });
        yield undefined;
      })()) as never;

    await expect(generateStructuredWithFallback({
      ...baseOptions({
        resolved: { ...baseOptions().resolved, fallbackModelId: "" },
        timeoutMs: 5,
        signal: external.signal,
      }),
      loadQuery: async () => query,
    })).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });

  test("uses one Sonnet fallback when Haiku output fails domain grounding", async () => {
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

    const result = generateStructuredWithFallback({
      ...baseOptions({
        repo: "xbmc/repo-plugins",
        costTracker: { trackAgentSdkCall } as never,
        validate: (value: unknown) => {
          validationCount++;
          if (validationCount === 1) throw new Error("invalid grounded output");
          return value as ReviewOutput;
        },
      }),
      loadQuery: async () => {
        loadCount++;
        return query;
      },
    });

    await expect(result).resolves.toMatchObject({
      usedFallback: true,
      fallbackReason: "domain-grounding-rejection",
      model: "claude-sonnet-5",
    });
    expect(capturedModels).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5",
    ]);
    expect(loadCount).toBe(2);
    expect(trackAgentSdkCall).toHaveBeenCalledTimes(2);
    expect(trackAgentSdkCall).toHaveBeenNthCalledWith(1, expect.objectContaining({
      usedFallback: false,
      fallbackReason: undefined,
    }));
    expect(trackAgentSdkCall).toHaveBeenNthCalledWith(2, expect.objectContaining({
      usedFallback: true,
      fallbackReason: "domain-grounding-rejection",
    }));
    expect(validationCount).toBe(2);
  });

  test("stops after exactly two domain-grounding rejections", async () => {
    const capturedModels: string[] = [];
    const query = ((input: { options: { model: string } }) => {
      capturedModels.push(input.options.model);
      return (async function* () {
        yield successResult({ summary: "Reviewed.", findings: [] });
      })();
    }) as never;

    await expect(generateStructuredWithFallback({
      ...baseOptions({
        validate: () => {
          throw new Error("ungrounded");
        },
      }),
      loadQuery: async () => query,
    })).rejects.toMatchObject({
      kind: "domain-grounding-rejection",
      retryable: true,
    });
    expect(capturedModels).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5",
    ]);
  });

  test("cost-tracks a retryable primary result and successful fallback result", async () => {
    const trackAgentSdkCall = mock(() => Promise.resolve());
    let callCount = 0;
    const query = ((input: { options: { model: string } }) => {
      callCount++;
      return (async function* () {
        const usage = {
          [input.options.model]: {
            inputTokens: callCount,
            outputTokens: callCount + 1,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        };
        if (callCount === 1) {
          yield {
            type: "result",
            subtype: "error_during_execution",
            modelUsage: usage,
            duration_ms: 10,
            total_cost_usd: 0.01,
          };
        } else {
          yield successResult({ summary: "Reviewed.", findings: [] }, usage);
        }
      })();
    }) as never;

    const result = await generateStructuredWithFallback({
      ...baseOptions({
        repo: "xbmc/repo-plugins",
        deliveryId: "delivery-fallback",
        costTracker: { trackAgentSdkCall } as never,
      }),
      loadQuery: async () => query,
    });

    expect(result).toMatchObject({
      usedFallback: true,
      fallbackReason: "execution-error",
      model: "claude-sonnet-5",
    });
    expect(trackAgentSdkCall).toHaveBeenCalledTimes(2);
    expect(trackAgentSdkCall).toHaveBeenNthCalledWith(1, expect.objectContaining({
      repo: "xbmc/repo-plugins",
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      model: "claude-haiku-4-5-20251001",
      deliveryId: "delivery-fallback",
      usedFallback: false,
      fallbackReason: undefined,
    }));
    expect(trackAgentSdkCall).toHaveBeenNthCalledWith(2, expect.objectContaining({
      repo: "xbmc/repo-plugins",
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      model: "claude-sonnet-5",
      deliveryId: "delivery-fallback",
      usedFallback: true,
      fallbackReason: "execution-error",
    }));
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

  test("maps bounded SDK error subtypes with deliberate retryability", async () => {
    for (const [subtype, kind, retryable] of [
      ["error_max_structured_output_retries", "structured-output-retries-exhausted", true],
      ["error_max_turns", "turn-limit", true],
      ["error_max_budget_usd", "budget-limit", false],
      ["error_during_execution", "execution-error", true],
    ] as const) {
      const query = (() => (async function* () {
        yield { type: "result", subtype, modelUsage: {}, duration_ms: 1 };
      })()) as never;
      await expect(generateStructuredWithFallback({
        ...baseOptions({ resolved: { ...baseOptions().resolved, fallbackModelId: "" } }),
        loadQuery: async () => query,
      })).rejects.toMatchObject({ kind, retryable });
    }
  });

  test("rejects a successful result without structured output", async () => {
    const query = (() => (async function* () {
      yield { type: "result", subtype: "success", modelUsage: {}, duration_ms: 1 };
    })()) as never;
    await expect(generateStructuredWithFallback({
      ...baseOptions({ resolved: { ...baseOptions().resolved, fallbackModelId: "" } }),
      loadQuery: async () => query,
    })).rejects.toMatchObject({ kind: "missing-structured-output", retryable: true });
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
        chunkOrdinal: 2,
        chunkTotal: 3,
      }),
      loadQuery: async () => query,
    });

    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(trackAgentSdkCall).toHaveBeenCalledWith({
      repo: "xbmc/repo-plugins",
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      model: "claude-haiku-4-5-20251001",
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      durationMs: 12,
      costUsd: 0,
      usedFallback: false,
      fallbackReason: undefined,
      deliveryId: "delivery",
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({
      taskType: TASK_TYPES.GUARDRAIL_CLASSIFICATION,
      requestedModel: "claude-haiku-4-5-20251001",
      resolvedModel: "claude-haiku-4-5-20251001",
      attempt: 1,
      durationMs: expect.any(Number),
      completionCategory: "success",
      promptCharacterCount: 13,
      chunkOrdinal: 2,
      chunkTotal: 3,
    }, "Claude Agent SDK structured generation attempt completed");
    const serializedLogs = JSON.stringify((logger.info as ReturnType<typeof mock>).mock.calls);
    expect(serializedLogs).not.toContain("secret prompt");
    expect(serializedLogs).not.toContain("secret output");
  });
});
