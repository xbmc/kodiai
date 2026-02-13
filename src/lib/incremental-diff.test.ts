import { describe, expect, test } from "bun:test";
import { computeIncrementalDiff, type IncrementalDiffResult } from "./incremental-diff.ts";

// Lightweight logger stub for tests
const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
  level: "silent",
} as unknown as import("pino").Logger;

describe("computeIncrementalDiff", () => {
  test("returns mode=full when getLastReviewedHeadSha returns null", async () => {
    const result = await computeIncrementalDiff({
      workspaceDir: "/tmp/nonexistent",
      repo: "owner/repo",
      prNumber: 1,
      getLastReviewedHeadSha: () => null,
      logger: noopLogger,
    });

    expect(result.mode).toBe("full");
    expect(result.changedFilesSinceLastReview).toEqual([]);
    expect(result.lastReviewedHeadSha).toBeNull();
    expect(result.reason).toBe("no-prior-review");
  });

  test("returns IncrementalDiffResult with correct type shape", async () => {
    // When getLastReviewedHeadSha returns null, we get a well-typed result
    // without needing a real git workspace
    const result: IncrementalDiffResult = await computeIncrementalDiff({
      workspaceDir: "/tmp/nonexistent",
      repo: "owner/repo",
      prNumber: 42,
      getLastReviewedHeadSha: () => null,
      logger: noopLogger,
    });

    // Verify the shape satisfies IncrementalDiffResult
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("changedFilesSinceLastReview");
    expect(result).toHaveProperty("lastReviewedHeadSha");
    expect(result).toHaveProperty("reason");
    expect(["incremental", "full"]).toContain(result.mode);
    expect(Array.isArray(result.changedFilesSinceLastReview)).toBe(true);
  });

  test("returns mode=full with reason when prior SHA is provided but workspace is invalid", async () => {
    // When a SHA is returned but the workspace doesn't exist, git commands fail
    // and the function should degrade gracefully to full mode
    const result = await computeIncrementalDiff({
      workspaceDir: "/tmp/nonexistent-workspace-" + Date.now(),
      repo: "owner/repo",
      prNumber: 5,
      getLastReviewedHeadSha: () => "abc1234567890def",
      logger: noopLogger,
    });

    expect(result.mode).toBe("full");
    // Should either be unreachable or unexpected-error depending on how git fails
    expect(["prior-sha-unreachable", "unexpected-error"]).toContain(result.reason);
  });

  test("returns mode=full with reason unexpected-error when getLastReviewedHeadSha throws", async () => {
    const result = await computeIncrementalDiff({
      workspaceDir: "/tmp/nonexistent",
      repo: "owner/repo",
      prNumber: 10,
      getLastReviewedHeadSha: () => {
        throw new Error("database connection lost");
      },
      logger: noopLogger,
    });

    expect(result.mode).toBe("full");
    expect(result.reason).toBe("unexpected-error");
    expect(result.changedFilesSinceLastReview).toEqual([]);
  });

  // Note: The git-dependent paths (incremental mode with real diff output)
  // are integration-tested in the review handler tests, since they require
  // a real git workspace with commit history.
});
