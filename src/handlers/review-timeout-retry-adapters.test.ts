import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import { buildReviewRetryOutcomeCheckpointLookup } from "./review-timeout-retry-adapters.ts";

describe("buildReviewRetryOutcomeCheckpointLookup", () => {
  test("loads retry checkpoints from the optional knowledge store", async () => {
    const calls: string[] = [];
    const checkpoint: CheckpointRecord = {
      reviewOutputKey: "retry-key",
      repo: "acme/repo",
      prNumber: 42,
      filesReviewed: ["src/a.ts"],
      findingCount: 1,
      summaryDraft: "summary",
      totalFiles: 2,
    };
    const getCheckpoint = buildReviewRetryOutcomeCheckpointLookup({
      knowledgeStore: {
        async getCheckpoint(key: string) {
          calls.push(key);
          return checkpoint;
        },
      },
    });

    await expect(getCheckpoint("retry-key")).resolves.toBe(checkpoint);
    expect(calls).toEqual(["retry-key"]);
  });

  test("returns null when checkpoint persistence is unavailable", async () => {
    const getCheckpoint = buildReviewRetryOutcomeCheckpointLookup({
      knowledgeStore: undefined,
    });

    await expect(getCheckpoint("retry-key")).resolves.toBeNull();
  });
});
