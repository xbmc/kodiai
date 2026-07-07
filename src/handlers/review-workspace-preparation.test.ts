import { describe, expect, mock, test } from "bun:test";
import {
  prepareReviewRetryWorkspace,
  prepareReviewWorkspace,
} from "./review-workspace-preparation.ts";

function logger() {
  return { warn: mock(() => {}) };
}

describe("prepareReviewWorkspace", () => {
  test("uses trusted base config for PR-ref fork reviews before checking out untrusted head", async () => {
    const calls: string[] = [];
    const workspace = { dir: "/tmp/workspace", token: "token-1", cleanup: mock(async () => {}) };
    const workspaceManager = {
      create: mock(async () => {
        calls.push("create");
        return workspace;
      }),
    };
    const loadRepoConfigFn = mock(async () => {
      calls.push("load-config");
      return {
        config: { review: { enabled: true } },
        warnings: [{ section: "review", issues: ["base warning"] }],
      };
    });
    const fetchAndCheckoutPullRequestHeadRefFn = mock(async () => {
      calls.push("checkout-pr-head");
      return { localBranch: "pr-review", source: "pull-ref" as const };
    });
    const fetchRemoteTrackingBranchFn = mock(async () => {
      calls.push("fetch-base");
    });
    const log = logger();

    const result = await prepareReviewWorkspace({
      workspaceManager,
      installationId: 123,
      owner: "fork-owner",
      repo: "fork-repo",
      ref: "pull/17/head",
      depth: 12,
      usesPrRef: true,
      prNumber: 17,
      baseRef: "main",
      fallbackHeadRepoFullName: "fork-owner/fork-repo",
      fallbackHeadRef: "feature",
      loadRepoConfigFn: loadRepoConfigFn as never,
      fetchAndCheckoutPullRequestHeadRefFn,
      fetchRemoteTrackingBranchFn,
      logger: log,
      now: mock(() => 1000),
    });

    expect(result.workspace).toBe(workspace);
    expect(result.config as unknown).toEqual({ review: { enabled: true } });
    expect(calls).toEqual(["create", "load-config", "checkout-pr-head", "fetch-base"]);
    expect(fetchAndCheckoutPullRequestHeadRefFn).toHaveBeenCalledWith({
      dir: "/tmp/workspace",
      prNumber: 17,
      localBranch: "pr-review",
      token: "token-1",
      fallbackRemoteUrl: "https://github.com/fork-owner/fork-repo.git",
      fallbackRef: "feature",
      depth: 12,
    });
    expect(fetchRemoteTrackingBranchFn).toHaveBeenCalledWith({
      dir: "/tmp/workspace",
      branch: "main",
      token: "token-1",
      depth: 12,
    });
    expect(log.warn).toHaveBeenCalledWith(
      { section: "review", issues: ["base warning"] },
      "Config warning detected",
    );
  });

  test("loads config from the checked-out workspace for same-repo reviews", async () => {
    const calls: string[] = [];
    const workspace = { dir: "/tmp/workspace", token: "token-2", cleanup: mock(async () => {}) };
    const workspaceManager = {
      create: mock(async () => {
        calls.push("create");
        return workspace;
      }),
    };
    const loadRepoConfigFn = mock(async () => {
      calls.push("load-config");
      return {
        config: { review: { enabled: false } },
        warnings: [],
      };
    });
    const fetchAndCheckoutPullRequestHeadRefFn = mock(async () => {
      calls.push("checkout-pr-head");
      return { localBranch: "pr-review", source: "pull-ref" as const };
    });
    const fetchRemoteTrackingBranchFn = mock(async () => {
      calls.push("fetch-base");
    });

    const result = await prepareReviewWorkspace({
      workspaceManager,
      installationId: 456,
      owner: "owner",
      repo: "repo",
      ref: "feature",
      depth: 7,
      usesPrRef: false,
      prNumber: 4,
      baseRef: "main",
      fallbackHeadRepoFullName: null,
      fallbackHeadRef: "feature",
      loadRepoConfigFn: loadRepoConfigFn as never,
      fetchAndCheckoutPullRequestHeadRefFn,
      fetchRemoteTrackingBranchFn,
      logger: logger(),
      now: mock(() => 2000),
    });

    expect(result.config as unknown).toEqual({ review: { enabled: false } });
    expect(calls).toEqual(["create", "fetch-base", "load-config"]);
    expect(fetchAndCheckoutPullRequestHeadRefFn).not.toHaveBeenCalled();
  });

  test("prepares retry workspaces with the retry local branch without loading config", async () => {
    const workspace = { dir: "/tmp/retry-workspace", token: "token-3", cleanup: mock(async () => {}) };
    const workspaceManager = {
      create: mock(async () => workspace),
    };
    const fetchAndCheckoutPullRequestHeadRefFn = mock(async () => ({ localBranch: "pr-review-retry-1", source: "pull-ref" as const }));
    const fetchRemoteTrackingBranchFn = mock(async () => {});

    const result = await prepareReviewRetryWorkspace({
      workspaceManager,
      installationId: 789,
      owner: "owner",
      repo: "repo",
      ref: "pull/8/head",
      depth: 5,
      usesPrRef: true,
      prNumber: 8,
      baseRef: "main",
      fallbackHeadRepoFullName: "fork/repo",
      fallbackHeadRef: "feature",
      localBranch: "pr-review-retry-1",
      fetchAndCheckoutPullRequestHeadRefFn: fetchAndCheckoutPullRequestHeadRefFn as never,
      fetchRemoteTrackingBranchFn,
    });

    expect(result).toBe(workspace);
    expect(fetchAndCheckoutPullRequestHeadRefFn).toHaveBeenCalledWith({
      dir: "/tmp/retry-workspace",
      prNumber: 8,
      localBranch: "pr-review-retry-1",
      token: "token-3",
      fallbackRemoteUrl: "https://github.com/fork/repo.git",
      fallbackRef: "feature",
      depth: 5,
    });
    expect(fetchRemoteTrackingBranchFn).toHaveBeenCalledWith({
      dir: "/tmp/retry-workspace",
      branch: "main",
      token: "token-3",
      depth: 5,
    });
  });

  test("cleans up workspaces when checkout fails before returning to the handler", async () => {
    const checkoutError = new Error("checkout failed");
    const workspace = { dir: "/tmp/failing-workspace", token: "token-4", cleanup: mock(async () => {}) };
    const workspaceManager = {
      create: mock(async () => workspace),
    };

    await expect(prepareReviewRetryWorkspace({
      workspaceManager,
      installationId: 789,
      owner: "owner",
      repo: "repo",
      ref: "pull/8/head",
      depth: 5,
      usesPrRef: true,
      prNumber: 8,
      baseRef: "main",
      fallbackHeadRepoFullName: "fork/repo",
      fallbackHeadRef: "feature",
      localBranch: "pr-review-retry-1",
      fetchAndCheckoutPullRequestHeadRefFn: mock(async () => {
        throw checkoutError;
      }) as never,
      fetchRemoteTrackingBranchFn: mock(async () => {}),
    })).rejects.toThrow(checkoutError);

    expect(workspace.cleanup).toHaveBeenCalledTimes(1);
  });
});
