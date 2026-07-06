import { describe, expect, test } from "bun:test";
import { buildReviewDepBumpContext } from "./review-dep-bump-context.ts";

function makeLogger() {
  const entries: Array<{ level: "info" | "warn"; obj: unknown; msg: string }> = [];
  return {
    entries,
    logger: {
      info: (obj: unknown, msg: string) => entries.push({ level: "info", obj, msg }),
      warn: (obj: unknown, msg: string) => entries.push({ level: "warn", obj, msg }),
    },
  };
}

describe("buildReviewDepBumpContext", () => {
  test("builds, enriches, and scores a single-package dependency bump", async () => {
    const securityCalls: unknown[] = [];
    const changelogCalls: unknown[] = [];
    const usageCalls: unknown[] = [];
    const { logger, entries } = makeLogger();

    const context = await buildReviewDepBumpContext({
      dependsBumpInfo: null,
      prTitle: "Bump left-pad from 1.0.0 to 2.0.0",
      prBody: "Dependency update",
      prLabels: ["dependencies"],
      headBranch: "dependabot/npm_and_yarn/left-pad-2.0.0",
      senderLogin: "dependabot[bot]",
      changedFiles: ["package.json", "package-lock.json"],
      workspaceDir: "/tmp/workspace",
      octokit: {} as any,
      logger: logger as any,
      baseLog: { deliveryId: "delivery-1" },
      usageAnalyzer: async (params) => {
        usageCalls.push(params);
        return {
          evidence: [{ filePath: "src/app.ts", line: 7, snippet: "leftPad(value)" }],
          searchTerms: [params.packageName],
          timedOut: false,
        };
      },
      fetchSecurityAdvisories: async (params) => {
        securityCalls.push(params);
        return {
          advisories: [],
          isSecurityBump: false,
        };
      },
      fetchChangelog: async (params) => {
        changelogCalls.push(params);
        return {
          releaseNotes: [{ tag: "v2.0.0", body: "BREAKING CHANGE: API changed" }],
          breakingChanges: ["BREAKING CHANGE: API changed"],
          compareUrl: "https://example.test/compare",
          source: "releases",
        };
      },
    });

    expect(context?.details).toMatchObject({
      packageName: "left-pad",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      ecosystem: "npm",
      isGroup: false,
    });
    expect(context?.classification.bumpType).toBe("major");
    expect(context?.security?.isSecurityBump).toBe(false);
    expect(context?.changelog?.breakingChanges).toHaveLength(1);
    expect(context?.usageEvidence?.evidence).toHaveLength(1);
    expect(context?.mergeConfidence?.level).toEqual(expect.any(String));
    expect(securityCalls).toHaveLength(1);
    expect(changelogCalls).toHaveLength(1);
    expect(usageCalls).toHaveLength(1);
    expect(entries.some((entry) => entry.msg === "Dependency bump detected")).toBe(true);
    expect(entries.some((entry) => entry.msg === "Merge confidence computed")).toBe(true);
  });

  test("skips bot detection when depends fast path already matched", async () => {
    const { logger } = makeLogger();

    const context = await buildReviewDepBumpContext({
      dependsBumpInfo: { packages: [], platform: "npm", isGroup: false } as any,
      prTitle: "Bump left-pad from 1.0.0 to 2.0.0",
      prBody: null,
      prLabels: ["dependencies"],
      headBranch: "dependabot/npm_and_yarn/left-pad-2.0.0",
      senderLogin: "dependabot[bot]",
      changedFiles: ["package.json"],
      workspaceDir: "/tmp/workspace",
      octokit: {} as any,
      logger: logger as any,
      baseLog: {},
      fetchSecurityAdvisories: async () => {
        throw new Error("should not enrich");
      },
      fetchChangelog: async () => {
        throw new Error("should not enrich");
      },
    });

    expect(context).toBeNull();
  });

  test("detects scope groups for grouped dependency bumps", async () => {
    const { logger } = makeLogger();

    const context = await buildReviewDepBumpContext({
      dependsBumpInfo: null,
      prTitle: "Update dependency group frontend",
      prBody: "- @acme/a\n- @acme/b\n- @other/c",
      prLabels: ["renovate"],
      headBranch: "renovate/frontend",
      senderLogin: "renovate[bot]",
      changedFiles: ["package.json"],
      workspaceDir: "/tmp/workspace",
      octokit: {} as any,
      logger: logger as any,
      baseLog: {},
    });

    expect(context?.details.isGroup).toBe(true);
    expect(context?.scopeGroups).toEqual([
      {
        scope: "@acme",
        packages: ["@acme/a", "@acme/b"],
      },
    ]);
    expect(context?.security).toBeUndefined();
    expect(context?.changelog).toBeUndefined();
    expect(context?.usageEvidence).toBeUndefined();
  });
});
