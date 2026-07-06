import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { evaluateReviewTriggerConfigGate } from "./review-trigger-config-gate.ts";

function makeLogger() {
  const entries: Array<{ data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ data, message });
      },
    } as unknown as Pick<Logger, "info">,
  };
}

const triggers = {
  onOpened: true,
  onReadyForReview: true,
  onReviewRequested: true,
  onSynchronize: false,
};

describe("evaluateReviewTriggerConfigGate", () => {
  test("continues when review is enabled and the action trigger is enabled", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewTriggerConfigGate({
      action: "opened",
      reviewConfig: { enabled: true, triggers },
      apiOwner: "xbmc",
      apiRepo: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(entries).toEqual([
      {
        data: {
          prNumber: 42,
          gate: "trigger-config",
          reviewEnabled: true,
          triggers,
        },
        message: "Evaluating review trigger configuration",
      },
    ]);
  });

  test("skips when review is disabled in config", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewTriggerConfigGate({
      action: "opened",
      reviewConfig: { enabled: false, triggers },
      apiOwner: "xbmc",
      apiRepo: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries.map((entry) => entry.message)).toEqual([
      "Evaluating review trigger configuration",
      "Review disabled in config, skipping",
    ]);
    expect(entries[1]?.data).toEqual({
      prNumber: 42,
      gate: "review-enabled",
      gateResult: "skipped",
      skipReason: "review-disabled",
      apiOwner: "xbmc",
      apiRepo: "kodiai",
    });
  });

  test("skips when the event trigger is disabled", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewTriggerConfigGate({
      action: "synchronize",
      reviewConfig: { enabled: true, triggers },
      apiOwner: "xbmc",
      apiRepo: "kodiai",
      baseLog: { prNumber: 42 },
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries.map((entry) => entry.message)).toEqual([
      "Evaluating review trigger configuration",
      "Review trigger disabled in config, skipping",
    ]);
    expect(entries[1]?.data).toEqual({
      prNumber: 42,
      gate: "review-trigger",
      gateResult: "skipped",
      skipReason: "trigger-disabled",
      triggers,
    });
  });
});
