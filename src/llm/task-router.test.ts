import { describe, expect, test } from "bun:test";
import { TASK_TYPES } from "./task-types.ts";
import { createTaskRouter } from "./task-router.ts";

describe("createTaskRouter", () => {
  test("uses a distinct default fallback for agentic Sonnet tasks", () => {
    const resolved = createTaskRouter({ models: {} }).resolve(TASK_TYPES.REVIEW_FULL);

    expect(resolved.modelId).toBe("claude-sonnet-4-5-20250929");
    expect(resolved.fallbackModelId).toBe("claude-haiku-4-5-20250929");
  });

  test("uses a distinct default fallback for non-agentic Haiku tasks", () => {
    const resolved = createTaskRouter({ models: {} }).resolve(TASK_TYPES.REVIEW_SUMMARY);

    expect(resolved.modelId).toBe("claude-haiku-4-5-20250929");
    expect(resolved.fallbackModelId).toBe("claude-sonnet-4-5-20250929");
  });
});
