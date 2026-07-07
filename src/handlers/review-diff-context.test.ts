import { describe, expect, mock, test } from "bun:test";
import type { PullRequestFileMetadata } from "../lib/github-pr-files.ts";
import type {
  collectDiffContext,
  DiffCollectionResult,
} from "../review-orchestration/review-diff-collection.ts";
import { resolveReviewDiffContext } from "./review-diff-context.ts";

type DiffContextCollectorParams = Parameters<typeof collectDiffContext>[0];

describe("resolveReviewDiffContext", () => {
  test("collects diff context with GitHub PR file fallback and builds commentability index", async () => {
    const fallbackFiles: PullRequestFileMetadata[] = [{
      filename: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: "@@ -10,2 +10,3 @@\n-old\n+new\n+added",
    }];
    const fetchPullRequestFiles = mock(async () => fallbackFiles);
    const diffContextCollector = mock(async (params: DiffContextCollectorParams): Promise<DiffCollectionResult> => {
      const files = await params.fallbackDiffProvider?.() ?? [];
      return {
        changedFiles: files.map((file) => file.filename),
        numstatLines: files.map((file) => `${file.additions}\t${file.deletions}\t${file.filename}`),
        diffContent: [
          "diff --git a/src/app.ts b/src/app.ts",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -10,2 +10,3 @@",
          "-old",
          "+new",
          "+added",
        ].join("\n"),
        strategy: "github-pr-files-fallback" as const,
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:pr-files",
      };
    });

    const result = await resolveReviewDiffContext({
      diffContextCollector,
      workspaceDir: "/workspace",
      baseRef: "main",
      token: "token",
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      logger: {} as never,
      baseLog: { deliveryId: "delivery-1" },
      fetchPullRequestFiles,
    });

    expect(fetchPullRequestFiles).toHaveBeenCalledWith({
      octokit: {},
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
    });
    expect(diffContextCollector).toHaveBeenCalledWith(expect.objectContaining({
      workspaceDir: "/workspace",
      baseRef: "main",
      maxFilesForFullDiff: 200,
      token: "token",
      baseLog: { deliveryId: "delivery-1" },
    }));
    expect(result.diffContext.changedFiles).toEqual(["src/app.ts"]);
    expect(result.diffContentForValidation).toContain("diff --git");
    expect(result.allChangedFiles).toEqual(["src/app.ts"]);
    expect(result.prDiffCommentabilityIndex?.get("src/app.ts")?.has(10)).toBe(true);
  });

  test("omits commentability index when diff content is unavailable", async () => {
    const result = await resolveReviewDiffContext({
      diffContextCollector: mock(async (): Promise<DiffCollectionResult> => ({
        changedFiles: ["README.md"],
        numstatLines: ["1\t0\tREADME.md"],
        strategy: "github-file-list-fallback" as const,
        mergeBaseRecovered: false,
        deepenAttempts: 0,
        unshallowAttempted: false,
        diffRange: "github-api:files",
      })),
      workspaceDir: "/workspace",
      baseRef: "main",
      token: "token",
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      logger: {} as never,
      baseLog: { deliveryId: "delivery-1" },
      fetchPullRequestFiles: mock(async () => {
        throw new Error("should not be called by collector");
      }),
    });

    expect(result.diffContentForValidation).toBe("");
    expect(result.prDiffCommentabilityIndex).toBeUndefined();
    expect(result.allChangedFiles).toEqual(["README.md"]);
  });
});
