import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { ContributorProfileStore } from "../contributor/types.ts";
import type { CodeSnippetStore } from "../knowledge/code-snippet-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import {
  completeReviewRunFailOpen,
  scheduleContributorExpertiseUpdate,
  scheduleReviewHunkEmbedding,
} from "./review-post-execution-side-effects.ts";

const fakeContributorStore = { kind: "store" } as unknown as ContributorProfileStore;
const fakeCodeSnippetStore = { kind: "code-snippets" } as unknown as CodeSnippetStore;
const fakeEmbeddingProvider = { kind: "embeddings" } as unknown as EmbeddingProvider;

describe("completeReviewRunFailOpen", () => {
  test("marks the idempotency run complete with the canonical run key", async () => {
    const completeRun = mock(async (_runKey: string) => {});
    const logger = { warn: mock(() => {}) };

    const result = await completeReviewRunFailOpen({
      knowledgeStore: { completeRun },
      repo: "octo/repo",
      prNumber: 42,
      baseSha: "base",
      headSha: "head",
      logger,
      logContext: { deliveryId: "delivery-1" },
    });

    expect(result).toEqual({ ok: true, value: "completed" });
    expect(completeRun).toHaveBeenCalledWith("octo/repo:pr-42:base-base:head-head");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("logs and swallows completion failures", async () => {
    const err = new Error("db down");
    const completeRun = mock(async (_runKey: string) => {
      throw err;
    });
    const logger = { warn: mock(() => {}) };

    const result = await completeReviewRunFailOpen({
      knowledgeStore: { completeRun },
      repo: "octo/repo",
      prNumber: 42,
      baseSha: "base",
      headSha: "head",
      logger,
      logContext: { deliveryId: "delivery-1" },
    });

    expect(result).toEqual({ ok: false, err });
    expect(logger.warn).toHaveBeenCalledWith(
      { deliveryId: "delivery-1", err },
      "Failed to mark run as completed (non-fatal)",
    );
  });
});

describe("scheduleContributorExpertiseUpdate", () => {
  test("starts the contributor expertise update and logs async failures", async () => {
    const err = new Error("profile write failed");
    const updateExpertise = mock(async () => {
      throw err;
    });
    const logger = { warn: mock(() => {}) };

    const result = scheduleContributorExpertiseUpdate({
      contributorProfileStore: fakeContributorStore,
      githubUsername: "mona",
      filesChanged: ["src/a.ts"],
      logger,
      updateExpertise,
    });

    expect(result).toBe("scheduled");
    await Promise.resolve();
    await Promise.resolve();
    expect(updateExpertise).toHaveBeenCalledWith({
      githubUsername: "mona",
      filesChanged: ["src/a.ts"],
      type: "pr_authored",
      profileStore: fakeContributorStore,
      logger,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { err },
      "Contributor expertise update failed (non-blocking)",
    );
  });
});

describe("scheduleReviewHunkEmbedding", () => {
  test("splits diff content and schedules hunk embedding when enabled", async () => {
    const embedHunks = mock(async () => {});
    const logger = { warn: mock(() => {}) };

    const result = scheduleReviewHunkEmbedding({
      diffContent: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
      repo: "octo/repo",
      owner: "octo",
      prNumber: 42,
      prTitle: "Change a",
      codeSnippetStore: fakeCodeSnippetStore,
      embeddingProvider: fakeEmbeddingProvider,
      config: { enabled: true, maxHunksPerPr: 10, minChangedLines: 1, excludePatterns: [] },
      logger: logger as unknown as Logger,
      logContext: { deliveryId: "delivery-1" },
      embedHunks,
    });

    expect(result).toBe("scheduled");
    expect(embedHunks).toHaveBeenCalledWith({
      diffFiles: [{
        filename: "src/a.ts",
        patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
      }],
      repo: "octo/repo",
      owner: "octo",
      prNumber: 42,
      prTitle: "Change a",
      codeSnippetStore: fakeCodeSnippetStore,
      embeddingProvider: fakeEmbeddingProvider,
      config: { enabled: true, maxHunksPerPr: 10, minChangedLines: 1, excludePatterns: [] },
      logger: logger as unknown as Logger,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("skips hunk embedding when prerequisites are missing", () => {
    const result = scheduleReviewHunkEmbedding({
      diffContent: "",
      repo: "octo/repo",
      owner: "octo",
      prNumber: 42,
      prTitle: "Change a",
      codeSnippetStore: fakeCodeSnippetStore,
      embeddingProvider: fakeEmbeddingProvider,
      config: { enabled: true, maxHunksPerPr: 10, minChangedLines: 1, excludePatterns: [] },
      logger: { warn: mock(() => {}) } as unknown as Logger,
      logContext: {},
      embedHunks: mock(async () => {}),
    });

    expect(result).toBe("skipped");
  });

  test("logs async hunk embedding scheduling failures", async () => {
    const err = new Error("embedding failed");
    const embedHunks = mock(async () => {
      throw err;
    });
    const logger = { warn: mock(() => {}) };

    const result = scheduleReviewHunkEmbedding({
      diffContent: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
      repo: "octo/repo",
      owner: "octo",
      prNumber: 42,
      prTitle: "Change a",
      codeSnippetStore: fakeCodeSnippetStore,
      embeddingProvider: fakeEmbeddingProvider,
      config: { enabled: true, maxHunksPerPr: 10, minChangedLines: 1, excludePatterns: [] },
      logger: logger as unknown as Logger,
      logContext: { deliveryId: "delivery-1" },
      embedHunks,
    });

    expect(result).toBe("scheduled");
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith(
      { deliveryId: "delivery-1", err },
      "Hunk embedding failed (fire-and-forget)",
    );
  });
});
