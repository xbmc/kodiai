import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import { resolveReviewIncrementalDiff } from "./review-incremental-diff.ts";

function makeLogger() {
  const entries: Array<{ level: string; data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ level: "info", data, message });
      },
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ level: "warn", data, message });
      },
    } as unknown as Pick<Logger, "info" | "warn">,
  };
}

const incrementalResult: IncrementalDiffResult = {
  mode: "incremental",
  changedFilesSinceLastReview: ["src/app.ts"],
  lastReviewedHeadSha: "abc1234",
  reason: "incremental-from-abc1234",
};

describe("resolveReviewIncrementalDiff", () => {
  test("skips computation when no knowledge store is available", async () => {
    const { logger, entries } = makeLogger();

    const result = await resolveReviewIncrementalDiff({
      knowledgeStore: undefined,
      workspaceDir: "/workspace",
      repo: "xbmc/kodiai",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
      computeIncrementalDiffFn: async () => {
        throw new Error("should not be called");
      },
    });

    expect(result).toBeNull();
    expect(entries).toEqual([]);
  });

  test("logs and returns successful incremental diff results", async () => {
    const { logger, entries } = makeLogger();
    const calls: unknown[] = [];

    const result = await resolveReviewIncrementalDiff({
      knowledgeStore: {
        getLastReviewedHeadSha(params) {
          calls.push(params);
          return "abc1234";
        },
      },
      workspaceDir: "/workspace",
      repo: "xbmc/kodiai",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
      computeIncrementalDiffFn: async (params) => {
        calls.push({ workspaceDir: params.workspaceDir, repo: params.repo, prNumber: params.prNumber });
        return incrementalResult;
      },
    });

    expect(result).toEqual(incrementalResult);
    expect(calls).toEqual([
      { workspaceDir: "/workspace", repo: "xbmc/kodiai", prNumber: 42 },
    ]);
    expect(entries).toEqual([
      {
        level: "info",
        data: {
          deliveryId: "delivery",
          gate: "incremental-diff",
          mode: "incremental",
          reason: "incremental-from-abc1234",
        },
        message: "Incremental diff computation complete",
      },
    ]);
  });

  test("fails open and logs when incremental diff computation throws", async () => {
    const { logger, entries } = makeLogger();
    const err = new Error("boom");

    const result = await resolveReviewIncrementalDiff({
      knowledgeStore: {
        getLastReviewedHeadSha: () => "abc1234",
      },
      workspaceDir: "/workspace",
      repo: "xbmc/kodiai",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
      computeIncrementalDiffFn: async () => {
        throw err;
      },
    });

    expect(result).toBeNull();
    expect(entries).toEqual([
      {
        level: "warn",
        data: { deliveryId: "delivery", err },
        message: "Incremental diff computation failed (fail-open, full review)",
      },
    ]);
  });
});
