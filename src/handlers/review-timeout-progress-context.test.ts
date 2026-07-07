import { describe, expect, test } from "bun:test";
import type { CheckpointRecord } from "../knowledge/types.ts";
import type { ExtractedFinding } from "../review-orchestration/review-comment-finding-extraction.ts";
import {
  buildReviewTimeoutProgressAdapters,
  resolveReviewTimeoutProgressContext,
} from "./review-timeout-progress-context.ts";

function checkpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    reviewOutputKey: "review-key",
    repo: "acme/repo",
    prNumber: 42,
    filesReviewed: ["src/a.ts"],
    filesInspected: ["src/a.ts", "src/notes.md"],
    findingCount: 1,
    summaryDraft: "Partial review summary.",
    totalFiles: 5,
    ...overrides,
  };
}

function finding(filePath: string, commentId: number): ExtractedFinding {
  return {
    commentId,
    filePath,
    title: "Finding",
    severity: "medium",
    category: "correctness",
  };
}

describe("resolveReviewTimeoutProgressContext", () => {
  test("merges checkpoint progress with already-published inline findings", async () => {
    const progress = await resolveReviewTimeoutProgressContext({
      reviewOutputKey: "review-key",
      changedFileCount: 5,
      reviewBoundedness: null,
      outcome: {
        conclusion: "failure",
        isTimeout: true,
        published: true,
      },
      getCheckpoint: async () => checkpoint(),
      extractInlineFindings: async () => [
        finding("src/a.ts", 10),
        finding("src/b.ts", 11),
      ],
    });

    expect(progress.timeoutReviewedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(progress.timeoutInspectedFiles).toEqual(["src/a.ts", "src/b.ts", "src/notes.md"]);
    expect(progress.timeoutFindingCount).toBe(2);
    expect(progress.timeoutTotalFiles).toBe(5);
    expect(progress.hasPublishedInlines).toBe(true);
    expect(progress.hasPartialResults).toBe(true);
    expect(progress.timeoutFirstPass?.state).toBe("bounded-first-pass");
  });

  test("does not extract inline findings when no GitHub-visible findings were published", async () => {
    let extractionAttempted = false;

    const progress = await resolveReviewTimeoutProgressContext({
      reviewOutputKey: "review-key",
      changedFileCount: 3,
      reviewBoundedness: null,
      outcome: {
        conclusion: "failure",
        isTimeout: true,
        published: false,
      },
      getCheckpoint: async () => null,
      extractInlineFindings: async () => {
        extractionAttempted = true;
        return [finding("src/never.ts", 99)];
      },
    });

    expect(extractionAttempted).toBe(false);
    expect(progress.timeoutInlineFindings).toEqual([]);
    expect(progress.timeoutReviewedFiles).toEqual([]);
    expect(progress.timeoutInspectedFiles).toEqual([]);
    expect(progress.timeoutFindingCount).toBe(0);
    expect(progress.timeoutTotalFiles).toBe(3);
    expect(progress.hasPublishedInlines).toBe(false);
    expect(progress.hasPartialResults).toBe(false);
    expect(progress.timeoutFirstPass?.state).toBe("zero-evidence-failure");
  });
});

describe("buildReviewTimeoutProgressAdapters", () => {
  test("binds optional checkpoint lookup and inline finding extraction to timeout progress inputs", async () => {
    const checkpointCalls: string[] = [];
    const extractionCalls: Array<Record<string, unknown>> = [];
    const expectedCheckpoint = checkpoint();
    const expectedFindings = [finding("src/a.ts", 10)];

    const adapters = buildReviewTimeoutProgressAdapters({
      knowledgeStore: {
        async getCheckpoint(key: string) {
          checkpointCalls.push(key);
          return expectedCheckpoint;
        },
      },
      extractFindingsFromReviewComments: async (params) => {
        extractionCalls.push(params);
        return expectedFindings;
      },
      extraction: {
        octokit: { marker: "octokit" },
        owner: "acme",
        repo: "repo",
        prNumber: 42,
        reviewOutputKey: "review-key",
        logger: { warn: () => undefined },
        baseLog: { deliveryId: "delivery-1" },
      },
    });

    await expect(adapters.getCheckpoint("review-key")).resolves.toBe(expectedCheckpoint);
    await expect(adapters.extractInlineFindings()).resolves.toBe(expectedFindings);
    expect(checkpointCalls).toEqual(["review-key"]);
    expect(extractionCalls).toEqual([
      expect.objectContaining({
        owner: "acme",
        repo: "repo",
        prNumber: 42,
        reviewOutputKey: "review-key",
      }),
    ]);
  });

  test("returns null checkpoints when the knowledge store cannot load checkpoints", async () => {
    const adapters = buildReviewTimeoutProgressAdapters({
      knowledgeStore: undefined,
      extractFindingsFromReviewComments: async () => [],
      extraction: {
        octokit: {},
        owner: "acme",
        repo: "repo",
        prNumber: 42,
        reviewOutputKey: "review-key",
        logger: { warn: () => undefined },
        baseLog: {},
      },
    });

    await expect(adapters.getCheckpoint("review-key")).resolves.toBeNull();
  });
});
