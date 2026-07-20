import { describe, expect, test } from "bun:test";
import { TASK_TYPES } from "./task-types.ts";
import { createTaskRouter } from "./task-router.ts";

describe("createTaskRouter", () => {
  test("uses supported Haiku as the distinct fallback for agentic Sonnet tasks", () => {
    const resolved = createTaskRouter({ models: {} }).resolve(TASK_TYPES.REVIEW_FULL);

    expect(resolved.modelId).toBe("claude-sonnet-4-5-20250929");
    expect(resolved.fallbackModelId).toBe("claude-haiku-4-5-20251001");
  });

  test("uses supported Haiku for non-agentic tasks", () => {
    const resolved = createTaskRouter({ models: {} }).resolve(
      TASK_TYPES.GUARDRAIL_CLASSIFICATION,
    );

    expect(resolved.modelId).toBe("claude-haiku-4-5-20251001");
    expect(resolved.fallbackModelId).toBe("claude-sonnet-4-5-20250929");
  });
});
