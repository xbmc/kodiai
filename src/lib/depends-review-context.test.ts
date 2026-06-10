import { describe, expect, mock, test } from "bun:test";
import type { DependsBumpInfo } from "./depends-bump-detector.ts";
import { buildDependsReviewContext, createDependsReviewContextBuilder } from "./depends-review-context.ts";
import type { DependsReviewSignals } from "./depends-review-signals.ts";

function makeInfo(): DependsBumpInfo {
  return {
    packages: [{ name: "zlib", oldVersion: "1.3.1", newVersion: "1.3.2" }],
    platform: null,
    isGroup: false,
    rawTitle: "[depends] Bump zlib",
  };
}

describe("buildDependsReviewContext", () => {
  test("owns depends retrieval and summary assembly outside the review handler", async () => {
    const retrieve = mock(async () => ({
      unifiedResults: [
        {
          text: "Prior review mentioned ABI-sensitive zlib consumers.",
          createdAt: "2026-01-01T00:00:00.000Z",
          metadata: { authorLogin: "reviewer" },
        },
      ],
    }));
    const summarize = mock(async () => "Past comments point at ABI-sensitive zlib consumers.");

    const result = await buildDependsReviewContext({
      info: makeInfo(),
      prFiles: [],
      octokit: {} as never,
      owner: "xbmc",
      repo: "xbmc",
      workspaceDir: "/tmp/workspace",
      logger: { warn: mock(() => undefined), info: mock(() => undefined) } as never,
      baseLog: { deliveryId: "test" },
      deliveryId: "test",
      retriever: { retrieve },
      summarize,
    });

    expect(result.reviewData.contextSummary).toBe("Past comments point at ABI-sensitive zlib consumers.");
    expect(result.reviewData.retrievalContext).toHaveLength(1);
    expect(result.hasSourceChanges).toBe(false);
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      queries: ["zlib dependency bump update"],
      triggerType: "pr_review",
    }));
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  test("starts retrieval while signal collection is still running", async () => {
    const events: string[] = [];
    let releaseSignals: () => void = () => {};
    const signalsGate = new Promise<void>((resolve) => {
      releaseSignals = resolve;
    });
    const signalResult: DependsReviewSignals = {
      prFiles: [],
      hasSourceChanges: false,
      signals: {
        info: makeInfo(),
        versionDiffs: [],
        changelogs: [],
        hashResults: [],
        patchChanges: [],
        impact: null,
        transitive: null,
        platform: null,
      },
    };
    const collectSignals = mock(async () => {
      events.push("signals:start");
      await signalsGate;
      events.push("signals:end");
      return signalResult;
    });
    const retrieve = mock(async () => {
      events.push("retrieval:start");
      releaseSignals();
      return { unifiedResults: [] };
    });
    const buildWithCollector = createDependsReviewContextBuilder({ collectSignals });

    await buildWithCollector({
      info: makeInfo(),
      prFiles: [],
      octokit: {} as never,
      owner: "xbmc",
      repo: "xbmc",
      workspaceDir: "/tmp/workspace",
      logger: { warn: mock(() => undefined), info: mock(() => undefined) } as never,
      baseLog: { deliveryId: "test" },
      deliveryId: "test",
      retriever: { retrieve },
      summarize: mock(async () => null),
    });

    expect(events).toEqual(["signals:start", "retrieval:start", "signals:end"]);
    expect(collectSignals).toHaveBeenCalledTimes(1);
  });
});
