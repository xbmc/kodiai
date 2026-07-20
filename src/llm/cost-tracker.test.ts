import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { LlmCostRecord, TelemetryStore } from "../telemetry/types.ts";
import { createCostTracker } from "./cost-tracker.ts";

describe("createCostTracker", () => {
  test("persists Agent SDK primary defaults and bounded fallback attribution", async () => {
    const records: LlmCostRecord[] = [];
    const telemetryStore = {
      recordLlmCost: mock(async (record: LlmCostRecord) => {
        records.push(record);
      }),
    } as unknown as TelemetryStore;
    const logger = { warn: mock(() => undefined) } as unknown as Logger;
    const tracker = createCostTracker({ telemetryStore, logger });
    const common = {
      repo: "xbmc/repo-plugins",
      taskType: "guardrail.classification",
      inputTokens: 10,
      outputTokens: 4,
      durationMs: 12,
      deliveryId: "delivery-cost",
    };

    await tracker.trackAgentSdkCall({
      ...common,
      model: "claude-haiku-4-5-20251001",
    });
    await tracker.trackAgentSdkCall({
      ...common,
      model: "claude-sonnet-4-5-20250929",
      usedFallback: true,
      fallbackReason: "domain-grounding-rejection",
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      sdk: "agent",
      model: "claude-haiku-4-5-20251001",
      usedFallback: false,
    });
    expect(records[0]).not.toHaveProperty("fallbackReason");
    expect(records[1]).toMatchObject({
      sdk: "agent",
      model: "claude-sonnet-4-5-20250929",
      usedFallback: true,
      fallbackReason: "domain-grounding-rejection",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
