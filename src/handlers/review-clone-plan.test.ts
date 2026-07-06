import { describe, expect, test } from "bun:test";
import { resolveReviewClonePlan } from "./review-clone-plan.ts";

describe("resolveReviewClonePlan", () => {
  test("clones the PR head branch directly for same-repo pull requests", () => {
    expect(resolveReviewClonePlan({
      apiOwner: "xbmc",
      apiRepo: "kodiai",
      repositoryFullName: "xbmc/kodiai",
      baseRef: "main",
      headRef: "feature",
      headRepo: {
        full_name: "xbmc/kodiai",
        owner: { login: "xbmc" },
        name: "kodiai",
      },
    })).toEqual({
      cloneOwner: "xbmc",
      cloneRepo: "kodiai",
      cloneRef: "feature",
      isFork: false,
      isDeletedFork: false,
      usesPrRef: false,
      workspaceStrategy: "direct-head-branch-clone",
    });
  });

  test("clones the base ref and fetches the PR ref for fork pull requests", () => {
    expect(resolveReviewClonePlan({
      apiOwner: "xbmc",
      apiRepo: "kodiai",
      repositoryFullName: "xbmc/kodiai",
      baseRef: "main",
      headRef: "feature",
      headRepo: {
        full_name: "contributor/kodiai",
        owner: { login: "contributor" },
        name: "kodiai",
      },
    })).toEqual({
      cloneOwner: "xbmc",
      cloneRepo: "kodiai",
      cloneRef: "main",
      isFork: true,
      isDeletedFork: false,
      usesPrRef: true,
      workspaceStrategy: "base-clone+pull-ref-fetch",
    });
  });

  test("treats missing head repos as deleted forks and uses the base ref", () => {
    expect(resolveReviewClonePlan({
      apiOwner: "xbmc",
      apiRepo: "kodiai",
      repositoryFullName: "xbmc/kodiai",
      baseRef: "omega",
      headRef: "feature",
      headRepo: null,
    })).toEqual({
      cloneOwner: "xbmc",
      cloneRepo: "kodiai",
      cloneRef: "omega",
      isFork: false,
      isDeletedFork: true,
      usesPrRef: true,
      workspaceStrategy: "base-clone+pull-ref-fetch",
    });
  });
});
