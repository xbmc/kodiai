import { describe, expect, test } from "bun:test";
import { cleanupReviewExecutionResources } from "./review-execution-cleanup.ts";

describe("cleanupReviewExecutionResources", () => {
  test("cleans up the review workspace when present", async () => {
    let cleaned = false;

    await cleanupReviewExecutionResources({
      workspace: {
        cleanup: async () => {
          cleaned = true;
        },
      },
    });

    expect(cleaned).toBe(true);
  });

  test("skips absent resources", async () => {
    await expect(cleanupReviewExecutionResources({})).resolves.toBeUndefined();
  });
});
