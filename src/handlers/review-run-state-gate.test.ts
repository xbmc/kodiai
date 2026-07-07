import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { evaluateReviewRunStateGate } from "./review-run-state-gate.ts";

function makeLogger() {
  const entries: Array<{ level: string; data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ level: "info", data, message });
      },
      warn(data: Record<string, unknown>, message: string) {
        entries.push({ level: "warn", data, message });
      },
    } as unknown as Pick<Logger, "info" | "warn">,
  };
}

describe("evaluateReviewRunStateGate", () => {
  test("continues when no knowledge store is configured", async () => {
    const { logger, entries } = makeLogger();

    const decision = await evaluateReviewRunStateGate({
      knowledgeStore: undefined,
      repo: "owner/repo",
      prNumber: 42,
      baseSha: "base",
      headSha: "head",
      deliveryId: "delivery-1",
      action: "opened",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(entries).toEqual([]);
  });

  test("skips duplicate or already-processed runs with structured context", async () => {
    const { logger, entries } = makeLogger();

    const decision = await evaluateReviewRunStateGate({
      knowledgeStore: {
        checkAndClaimRun: async (params) => ({
          shouldProcess: false,
          runKey: `${params.repo}:${params.prNumber}`,
          reason: "duplicate",
          supersededRunKeys: [],
        }),
      },
      repo: "owner/repo",
      prNumber: 42,
      baseSha: "base",
      headSha: "head",
      deliveryId: "delivery-1",
      action: "synchronize",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries).toEqual([
      {
        level: "info",
        data: {
          prNumber: 42,
          gate: "run-state-idempotency",
          gateResult: "skipped",
          skipReason: "duplicate",
          runKey: "owner/repo:42",
        },
        message: "Skipping review: run state indicates duplicate or already processed",
      },
    ]);
  });

  test("continues and logs superseded prior runs", async () => {
    const { logger, entries } = makeLogger();

    const decision = await evaluateReviewRunStateGate({
      knowledgeStore: {
        checkAndClaimRun: async () => ({
          shouldProcess: true,
          runKey: "new-run",
          reason: "superseded-prior",
          supersededRunKeys: ["old-run"],
        }),
      },
      repo: "owner/repo",
      prNumber: 42,
      baseSha: "base",
      headSha: "head",
      deliveryId: "delivery-1",
      action: "synchronize",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(entries).toEqual([
      {
        level: "info",
        data: {
          prNumber: 42,
          gate: "run-state-idempotency",
          gateResult: "accepted",
          runKey: "new-run",
          supersededRunKeys: ["old-run"],
        },
        message: "New run superseded prior runs (force-push detected)",
      },
    ]);
  });

  test("fails open when the run-state claim throws", async () => {
    const { logger, entries } = makeLogger();
    const err = new Error("db unavailable");

    const decision = await evaluateReviewRunStateGate({
      knowledgeStore: {
        checkAndClaimRun: async () => {
          throw err;
        },
      },
      repo: "owner/repo",
      prNumber: 42,
      baseSha: "base",
      headSha: "head",
      deliveryId: "delivery-1",
      action: "opened",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(entries).toEqual([
      {
        level: "warn",
        data: { prNumber: 42, err },
        message: "Run state idempotency check failed (fail-open, proceeding with review)",
      },
    ]);
  });
});
