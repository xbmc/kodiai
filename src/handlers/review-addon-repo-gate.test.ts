import { describe, expect, test } from "bun:test";
import { evaluateGenericReviewAddonRepoGate, shouldSkipGenericReviewForAddonRepo } from "./review-addon-repo-gate.ts";

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

describe("shouldSkipGenericReviewForAddonRepo", () => {
  test("logs the specialized-review skip reason", () => {
    const entries: unknown[][] = [];
    const skipped = shouldSkipGenericReviewForAddonRepo({
      deliveryId: "delivery-1",
      repositoryFullName: "xbmc/repo-scripts",
      addonRepos: ["xbmc/repo-scripts"],
      logger: { info: (...args: unknown[]) => entries.push(args) },
    });

    expect(skipped).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.[0]).toMatchObject({
      deliveryId: "delivery-1",
      gateResult: "skipped",
      skipReason: "specialized-addon-review",
    });
  });
});
