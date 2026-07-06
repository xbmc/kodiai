import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { IncrementalDiffResult } from "../lib/incremental-diff.ts";
import type { PriorFinding } from "../knowledge/types.ts";
import { resolveReviewPriorFindingContext } from "./review-prior-finding-context.ts";

function makeLogger() {
  const entries: Array<{ level: string; data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ level: "warn", data, message });
      },
    } as unknown as Pick<Logger, "warn">,
  };
}

const incrementalResult: IncrementalDiffResult = {
  mode: "incremental",
  changedFilesSinceLastReview: ["src/changed.ts"],
  lastReviewedHeadSha: "abc1234",
  reason: "incremental-from-abc1234",
};

const priorFinding = (overrides: Partial<PriorFinding> = {}): PriorFinding => ({
  filePath: "src/unchanged.ts",
  title: "Existing issue",
  titleFingerprint: "existing-issue",
  severity: "major",
  category: "correctness",
  startLine: 10,
  endLine: 10,
  commentId: 123,
  ...overrides,
});

describe("resolveReviewPriorFindingContext", () => {
  test("skips lookup when there is no store or no incremental review", async () => {
    const { logger, entries } = makeLogger();
    const calls: unknown[] = [];

    const withoutStore = await resolveReviewPriorFindingContext({
      knowledgeStore: undefined,
      incrementalResult,
      repo: "acme/widgets",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
    });
    const fullReview = await resolveReviewPriorFindingContext({
      knowledgeStore: {
        getPriorReviewFindings(params) {
          calls.push(params);
          return [];
        },
      },
      incrementalResult: { ...incrementalResult, mode: "full", changedFilesSinceLastReview: [] },
      repo: "acme/widgets",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
    });

    expect(withoutStore).toEqual({ priorFindings: [], priorFindingCtx: null });
    expect(fullReview).toEqual({ priorFindings: [], priorFindingCtx: null });
    expect(calls).toEqual([]);
    expect(entries).toEqual([]);
  });

  test("loads prior findings and builds unchanged-code context for incremental reviews", async () => {
    const { logger, entries } = makeLogger();
    const findings = [
      priorFinding(),
      priorFinding({ filePath: "src/changed.ts", title: "Changed file issue", titleFingerprint: "changed-file" }),
    ];

    const result = await resolveReviewPriorFindingContext({
      knowledgeStore: {
        getPriorReviewFindings: async (params) => {
          expect(params).toEqual({ repo: "acme/widgets", prNumber: 42 });
          return findings;
        },
      },
      incrementalResult,
      repo: "acme/widgets",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
    });

    expect(result.priorFindings).toEqual(findings);
    expect(result.priorFindingCtx?.unresolvedOnUnchangedCode).toEqual([findings[0]!]);
    expect([...result.priorFindingCtx!.suppressionFingerprints]).toEqual([
      "src/unchanged.ts:existing-issue",
    ]);
    expect(entries).toEqual([]);
  });

  test("fails open and logs when prior finding lookup throws", async () => {
    const { logger, entries } = makeLogger();
    const err = new Error("store unavailable");

    const result = await resolveReviewPriorFindingContext({
      knowledgeStore: {
        getPriorReviewFindings: async () => {
          throw err;
        },
      },
      incrementalResult,
      repo: "acme/widgets",
      prNumber: 42,
      baseLog: { deliveryId: "delivery" },
      logger,
    });

    expect(result).toEqual({ priorFindings: [], priorFindingCtx: null });
    expect(entries).toEqual([
      {
        level: "warn",
        data: { deliveryId: "delivery", err },
        message: "Prior finding context failed (fail-open, no dedup)",
      },
    ]);
  });
});
