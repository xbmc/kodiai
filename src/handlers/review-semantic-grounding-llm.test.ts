import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { resolveReviewSemanticGroundingLLM } from "./review-semantic-grounding-llm.ts";

describe("resolveReviewSemanticGroundingLLM", () => {
  test("returns null when semantic grounding is disabled (default, mirrors graph validation's opt-in gate)", () => {
    const logger = {} as Logger;
    expect(resolveReviewSemanticGroundingLLM({
      enabled: false,
      repo: "xbmc/kodiai",
      deliveryId: "delivery-1",
      logger,
    })).toBeNull();
  });

  test("routes semantic grounding prompts through guardrail classification fallback generation", async () => {
    const logger = { info: () => undefined } as unknown as Logger;
    const resolved = {
      modelId: "claude-haiku",
      provider: "anthropic",
      sdk: "ai",
      fallbackModelId: "claude-haiku-fallback",
      fallbackProvider: "anthropic",
    } as const;
    const resolve = mock(() => resolved);
    const generateWithFallback = mock(async () => ({ text: "matched" }));
    const semanticGroundingLLM = resolveReviewSemanticGroundingLLM({
      enabled: true,
      repo: "xbmc/kodiai",
      deliveryId: "delivery-1",
      logger,
      createTaskRouter: () => ({ resolve }),
      generateWithFallback,
    });

    const text = await semanticGroundingLLM!.generate("prompt", "system");

    expect(text).toBe("matched");
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
