import { describe, expect, test } from "bun:test";
import { resolveReviewDependencyBumpFlowContext } from "./review-dependency-bump-flow.ts";

function baseParams(overrides: Partial<Parameters<typeof resolveReviewDependencyBumpFlowContext>[0]> = {}) {
  return {
    prTitle: "[depends] bump zlib",
    prBody: "body",
    prLabels: ["dependencies"],
    headBranch: "depends/zlib",
    senderLogin: "dependabot[bot]",
    changedFiles: ["tools/depends/target/zlib/Makefile"],
    workspaceDir: "/tmp/workspace",
    octokit: {} as never,
    owner: "xbmc",
    repo: "xbmc",
    prNumber: 123,
    logger: { info: () => undefined, warn: () => undefined } as never,
    baseLog: { deliveryId: "delivery-1" },
    botHandles: ["kodiai"],
    canPublishVisibleOutput: () => true,
    setReviewWorkPhase: () => undefined,
    ...overrides,
  };
}

describe("resolveReviewDependencyBumpFlowContext", () => {
  test("returns skip without running standard dep-bump enrichment when depends flow handles the review", async () => {
    let depBumpCalls = 0;
    const dependsBumpInfo = { packages: [], platform: "cmake", isGroup: false, rawTitle: "[depends] bump" } as never;

    const context = await resolveReviewDependencyBumpFlowContext(baseParams({
      resolveDependsFlow: async () => ({
        action: "skip-standard-review",
        dependsBumpInfo,
      }),
      buildDepBumpContext: async () => {
        depBumpCalls += 1;
        throw new Error("should not enrich after skip");
      },
    }));

    expect(context).toEqual({
      action: "skip-standard-review",
      dependsBumpInfo,
      depBumpContext: null,
    });
    expect(depBumpCalls).toBe(0);
  });

  test("continues with standard dep-bump enrichment when depends flow falls through", async () => {
    const calls: unknown[] = [];
    const depBumpContext = { detection: { source: "label" } } as never;

    const context = await resolveReviewDependencyBumpFlowContext(baseParams({
      prTitle: "Bump left-pad from 1.0.0 to 2.0.0",
      resolveDependsFlow: async (params) => {
        calls.push({ dependsTitle: params.prTitle, owner: params.owner, repo: params.repo });
        return {
          action: "continue-standard-review",
          dependsBumpInfo: null,
        };
      },
      buildDepBumpContext: async (params) => {
        calls.push({
          depTitle: params.prTitle,
          changedFiles: params.changedFiles,
          workspaceDir: params.workspaceDir,
          usageAnalyzer: params.usageAnalyzer,
          detectScopeCoordination: params.detectScopeCoordination,
        });
        return depBumpContext as never;
      },
      usageAnalyzer: async () => ({ evidence: [], searchTerms: [], timedOut: false }),
      detectScopeCoordination: () => [],
    }));

    expect(context).toEqual({
      action: "continue-standard-review",
      dependsBumpInfo: null,
      depBumpContext,
    });
    expect(calls).toEqual([
      { dependsTitle: "Bump left-pad from 1.0.0 to 2.0.0", owner: "xbmc", repo: "xbmc" },
      {
        depTitle: "Bump left-pad from 1.0.0 to 2.0.0",
        changedFiles: ["tools/depends/target/zlib/Makefile"],
        workspaceDir: "/tmp/workspace",
        usageAnalyzer: expect.any(Function),
        detectScopeCoordination: expect.any(Function),
      },
    ]);
  });
});
