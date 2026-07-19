import { describe, expect, test } from "bun:test";
import { evaluateGenericReviewAddonRepoGate } from "./review-addon-repo-gate.ts";

describe("evaluateGenericReviewAddonRepoGate", () => {
  test("skips a configured addon repository case-insensitively", () => {
    expect(evaluateGenericReviewAddonRepoGate({
      repositoryFullName: "XBMC/Repo-Scripts",
      addonRepos: ["xbmc/repo-scripts"],
    })).toEqual({ action: "skip", reason: "specialized-addon-review" });
  });

  test("continues generic review for all other repositories", () => {
    expect(evaluateGenericReviewAddonRepoGate({
      repositoryFullName: "xbmc/xbmc",
      addonRepos: ["xbmc/repo-scripts"],
    })).toEqual({ action: "continue" });
  });

  test("continues when repository identity is missing", () => {
    expect(evaluateGenericReviewAddonRepoGate({
      repositoryFullName: undefined,
      addonRepos: ["xbmc/repo-scripts"],
    })).toEqual({ action: "continue" });
  });
});
