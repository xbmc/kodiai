import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import {
  createReviewContinuationFamilyStateManager,
  extractBaseReviewOutputKey,
  parseAttemptOrdinal,
} from "./review-continuation-family-state.ts";

describe("extractBaseReviewOutputKey", () => {
  test("strips retry suffix from review output keys", () => {
    expect(extractBaseReviewOutputKey("rk_main-retry-2")).toBe("rk_main");
    expect(extractBaseReviewOutputKey("rk_main")).toBe("rk_main");
  });
});

describe("parseAttemptOrdinal", () => {
  test("reads trailing numeric ordinal from attempt ids", () => {
    expect(parseAttemptOrdinal("family-attempt-3")).toBe(3);
    expect(parseAttemptOrdinal("no-digits")).toBe(0);
  });
});

describe("createReviewContinuationFamilyStateManager", () => {
  test("skips publish when coordinator denies rights and logs supersession", async () => {
    const coordinator = createReviewWorkCoordinator();
    const automatic = coordinator.claim({
      familyKey: "xbmc/xbmc#1",
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-1",
      phase: "executor-dispatch",
    });
    const explicit = coordinator.claim({
      familyKey: "xbmc/xbmc#1",
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-2",
      phase: "executor-dispatch",
    });

    const infoEntries: Array<{ bindings: Record<string, unknown>; message: string }> = [];
    const logger = {
      info: (bindings: Record<string, unknown>, message: string) => {
        infoEntries.push({ bindings, message });
      },
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger,
    } as unknown as Logger;

    const manager = createReviewContinuationFamilyStateManager({
      logger,
      baseLog: { repo: "xbmc/xbmc", prNumber: 1 },
      reviewFamilyKey: "xbmc/xbmc#1",
      reviewOutputKey: "rk_test",
      reviewWorkCoordinator: coordinator,
    });

    expect(manager.canPublishReviewWorkOutput(automatic.attemptId, "review output", "delivery-1")).toBeFalse();
    expect(infoEntries).toHaveLength(1);
    expect(infoEntries[0]!.message).toBe("Skipping review output because publish rights were superseded");
    expect(infoEntries[0]!.bindings).toMatchObject({
      gate: "review-family-coordinator",
      gateResult: "skipped",
      skipReason: "publish-rights-lost",
      reviewWorkAttemptId: automatic.attemptId,
      supersededByAttemptId: explicit.attemptId,
    });

    expect(manager.canPublishReviewWorkOutput(explicit.attemptId, "review output", "delivery-2")).toBeTrue();
  });

  test("persists canonical continuation-family state when knowledge store is available", async () => {
    const writes: Record<string, unknown>[] = [];
    const coordinator = createReviewWorkCoordinator();
    const attempt = coordinator.claim({
      familyKey: "xbmc/xbmc#2",
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-3",
      phase: "claimed",
    });

    const manager = createReviewContinuationFamilyStateManager({
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        trace: () => undefined,
        fatal: () => undefined,
        child: () => ({}),
      } as unknown as Logger,
      baseLog: { repo: "xbmc/xbmc", prNumber: 2 },
      reviewFamilyKey: "xbmc/xbmc#2",
      reviewOutputKey: "rk_base-retry-1",
      knowledgeStore: {
        upsertContinuationFamilyState: async (record) => {
          writes.push(record);
        },
      },
      reviewWorkCoordinator: coordinator,
    });

    await manager.finalizeContinuationAttempt({
      attemptId: attempt.attemptId,
      fallbackOutcome: "merged",
      fallbackStopReason: "merged-continuation-results",
      reviewOutputKey: "rk_base-retry-1",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      familyKey: "xbmc/xbmc#2",
      baseReviewOutputKey: "rk_base",
      authoritativeAttemptId: attempt.attemptId,
      authoritativeOutcome: "merged",
      finalStopReason: "merged-continuation-results",
      projectionStatus: "canonical",
    });
  });
});
