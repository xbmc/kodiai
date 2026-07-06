import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { DependsBumpInfo } from "../lib/depends-bump-detector.ts";
import type { DependsReviewData, InlineComment } from "../lib/depends-review-builder.ts";
import { resolveReviewDependsFlow } from "./review-depends-flow.ts";

function createLogger() {
  const info = mock((_bindings: Record<string, unknown>, _message: string) => {});
  const warn = mock((_bindings: Record<string, unknown>, _message: string) => {});
  return {
    logger: { info, warn } as unknown as Pick<Logger, "info" | "warn">,
    info,
    warn,
  };
}

function dependsInfo(): DependsBumpInfo {
  return {
    packages: [{ name: "zlib", oldVersion: "1.2.12", newVersion: "1.3.1" }],
    platform: null,
    isGroup: false,
    rawTitle: "[depends] bump zlib to 1.3.1",
  };
}

function reviewData(info = dependsInfo()): DependsReviewData {
  return {
    info,
    versionDiffs: [],
    changelogs: [],
    hashResults: [],
    patchChanges: [],
    impact: null,
    transitive: null,
    retrievalContext: null,
    contextSummary: null,
    platform: null,
  };
}

describe("resolveReviewDependsFlow", () => {
  test("publishes a depends review and skips the standard review for pure dependency bumps", async () => {
    const { logger, info, warn } = createLogger();
    const detected = dependsInfo();
    const inlineComments: InlineComment[] = [{
      path: "tools/depends/target/zlib/Makefile",
      line: 12,
      body: "Check the version bump.",
    }];
    const fetchPullRequestFiles = mock(async () => [{
      filename: "tools/depends/target/zlib/Makefile",
      status: "modified",
      patch: "@@ -1 +1 @@",
    }]);
    const buildContext = mock(async () => ({
      reviewData: reviewData(detected),
      hasSourceChanges: false,
      prFiles: [],
    }));
    const publishOutput = mock(async () => ({
      publishedSummary: true,
      publishedInlineComments: true,
    }));
    const setReviewWorkPhase = mock((_phase: "publish") => {});

    const result = await resolveReviewDependsFlow({
      prTitle: detected.rawTitle,
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      workspaceDir: "/tmp/work",
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase,
      detectBump: mock(() => detected),
      fetchPullRequestFiles,
      buildContext,
      buildComment: mock(() => "depends summary"),
      buildInlineComments: mock(() => inlineComments),
      publishOutput,
    });

    expect(result).toEqual({
      action: "skip-standard-review",
      dependsBumpInfo: detected,
    });
    expect(fetchPullRequestFiles).toHaveBeenCalledWith({
      octokit: {},
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
    });
    expect(buildContext).toHaveBeenCalledWith(expect.objectContaining({
      info: detected,
      prFiles: [{
        filename: "tools/depends/target/zlib/Makefile",
        status: "modified",
        patch: "@@ -1 +1 @@",
      }],
      owner: "acme",
      repo: "widgets",
      workspaceDir: "/tmp/work",
      deliveryId: "42",
    }));
    expect(setReviewWorkPhase).toHaveBeenCalledWith("publish");
    expect(publishOutput).toHaveBeenCalledWith(expect.objectContaining({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      summaryBody: "depends summary",
      inlineComments,
      botHandles: ["kodiai", "claude"],
    }));
    expect(info.mock.calls.map((call) => call[1])).toEqual([
      "[depends] bump detected — entering deep-review pipeline",
      "[depends] deep review posted",
      "[depends] pure dep bump — skipping standard review",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("continues the standard review when a depends bump also changes source files", async () => {
    const { logger, info } = createLogger();
    const detected = dependsInfo();

    const result = await resolveReviewDependsFlow({
      prTitle: detected.rawTitle,
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      workspaceDir: null,
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: mock((_phase: "publish") => {}),
      detectBump: mock(() => detected),
      fetchPullRequestFiles: mock(async () => []),
      buildContext: mock(async () => ({
        reviewData: reviewData(detected),
        hasSourceChanges: true,
        prFiles: [],
      })),
      buildComment: mock(() => "depends summary"),
      buildInlineComments: mock(() => []),
      publishOutput: mock(async () => ({
        publishedSummary: false,
        publishedInlineComments: false,
      })),
    });

    expect(result).toEqual({
      action: "continue-standard-review",
      dependsBumpInfo: detected,
    });
    expect(info.mock.calls.at(-1)?.[0]).toMatchObject({
      gate: "depends-review-continue",
      verdict: "safe",
      hasSourceChanges: true,
    });
    expect(info.mock.calls.at(-1)?.[1]).toBe(
      "[depends] source changes detected — continuing to standard review",
    );
  });

  test("fails open to standard review and clears depends info when the pipeline fails", async () => {
    const { logger, warn } = createLogger();
    const detected = dependsInfo();
    const err = new Error("depends context failed");

    const result = await resolveReviewDependsFlow({
      prTitle: detected.rawTitle,
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      workspaceDir: null,
      logger,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      botHandles: ["kodiai", "claude"],
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: mock((_phase: "publish") => {}),
      detectBump: mock(() => detected),
      fetchPullRequestFiles: mock(async () => {
        throw err;
      }),
    });

    expect(result).toEqual({
      action: "continue-standard-review",
      dependsBumpInfo: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-1",
      prNumber: 42,
      err,
      gate: "depends-pipeline",
    });
    expect(warn.mock.calls[0]?.[1]).toBe(
      "[depends] pipeline failed (fail-open, falling through to standard review)",
    );
  });
});
