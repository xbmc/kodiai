import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { resolveReviewGraphValidationLLM } from "./review-graph-validation-llm.ts";

describe("resolveReviewGraphValidationLLM", () => {
  test("returns null when graph validation is disabled or no graph blast radius exists", () => {
    expect(resolveReviewGraphValidationLLM({
      enabled: false,
      hasGraphBlastRadius: true,
      repo: "xbmc/kodiai",
      deliveryId: "delivery-1",
      logger: {} as Logger,
    })).toBeNull();

    expect(resolveReviewGraphValidationLLM({
      enabled: true,
      hasGraphBlastRadius: false,
      repo: "xbmc/kodiai",
      deliveryId: "delivery-1",
      logger: {} as Logger,
    })).toBeNull();
  });

  test("routes graph validation prompts through guardrail classification fallback generation", async () => {
    const logger = { info: () => undefined } as unknown as Logger;
    const resolved = {
      modelId: "claude-haiku",
      provider: "anthropic",
      sdk: "ai",
      fallbackModelId: "claude-haiku-fallback",
      fallbackProvider: "anthropic",
    } as const;
    const resolve = mock(() => resolved);
    const generateWithFallback = mock(async () => ({ text: "validated" }));
    const graphValidationLLM = resolveReviewGraphValidationLLM({
      enabled: true,
      hasGraphBlastRadius: true,
      repo: "xbmc/kodiai",
      deliveryId: "delivery-1",
      logger,
      createTaskRouter: () => ({ resolve }),
      generateWithFallback,
    });

    const text = await graphValidationLLM!.generate("prompt", "system");

    expect(text).toBe("validated");
    expect(resolve).toHaveBeenCalledWith("guardrail.classification");
    expect(generateWithFallback).toHaveBeenCalledWith({
      taskType: "guardrail.classification",
      resolved,
      system: "system",
      prompt: "prompt",
      logger,
      repo: "xbmc/kodiai",
      deliveryId: "delivery-1",
    });
  });
});
