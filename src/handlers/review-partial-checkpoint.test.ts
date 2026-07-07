import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import { persistPartialReviewCheckpoint } from "./review-partial-checkpoint.ts";

describe("persistPartialReviewCheckpoint", () => {
  test("uses saveCheckpoint to persist the full partial review checkpoint when available", async () => {
    const checkpoints: CheckpointRecord[] = [];

    await persistPartialReviewCheckpoint({
      knowledgeStore: {
        saveCheckpoint: async (checkpoint) => {
          checkpoints.push(checkpoint);
        },
      },
      logger: { warn: () => undefined },
      checkpoint: {
        reviewOutputKey: "review-output-key",
        repo: "acme/repo",
        prNumber: 42,
        filesReviewed: ["src/a.ts"],
        filesInspected: ["src/a.ts", "src/b.ts"],
        findingCount: 2,
        summaryDraft: "Partial summary.",
        totalFiles: 5,
        partialCommentId: 123,
      },
    });

    expect(checkpoints).toEqual([{
      reviewOutputKey: "review-output-key",
      repo: "acme/repo",
      prNumber: 42,
      filesReviewed: ["src/a.ts"],
      filesInspected: ["src/a.ts", "src/b.ts"],
      findingCount: 2,
      summaryDraft: "Partial summary.",
      totalFiles: 5,
      partialCommentId: 123,
    }]);
  });

  test("falls back to best-effort comment id update and logs update failures", async () => {
    const error = new Error("checkpoint row missing");
    const updates: Array<{ reviewOutputKey: string; commentId: number }> = [];
    const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];

    await persistPartialReviewCheckpoint({
      knowledgeStore: {
        updateCheckpointCommentId: async (reviewOutputKey, commentId) => {
          updates.push({ reviewOutputKey, commentId });
          throw error;
        },
      },
      logger: {
        warn: (fields, message) => {
          warnings.push({ fields, message });
        },
      },
      checkpoint: {
        reviewOutputKey: "review-output-key",
        repo: "acme/repo",
        prNumber: 42,
        filesReviewed: [],
        filesInspected: [],
        findingCount: 0,
        summaryDraft: "",
        totalFiles: 5,
        partialCommentId: 123,
      },
    });

    expect(updates).toEqual([{ reviewOutputKey: "review-output-key", commentId: 123 }]);
    expect(warnings).toEqual([{
      fields: { err: error, reviewOutputKey: "review-output-key" },
      message: "Checkpoint comment id update failed (non-blocking)",
    }]);
  });
});
