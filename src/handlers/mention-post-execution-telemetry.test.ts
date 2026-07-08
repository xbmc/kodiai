import { describe, expect, test } from "bun:test";
import { recordMentionPostExecutionTelemetry } from "./mention-post-execution-telemetry.ts";
import { MentionExecutionTelemetryError } from "./mention-telemetry.ts";

function makeExecutionResult() {
  return {
    conclusion: "success",
    published: false,
    costUsd: 6,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 100,
    model: "claude-haiku",
  };
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    telemetryEnabled: true,
    telemetryStore: {
      recordRateLimitEvent: async () => undefined,
      record: async () => undefined,
      recordPromptSections: async () => undefined,
    },
    logger: { warn: () => undefined },
    deliveryId: "delivery-1",
    owner: "xbmc",
    repo: "kodiai",
    issueNumber: 42,
    prNumber: 42,
    eventType: "issue_comment.created",
    result: makeExecutionResult(),
    derivedContextCacheStatus: "hit",
    costWarningUsd: 10,
    explicitReviewRequest: false,
    canPublishExplicitReviewOutput: () => true,
    getOctokit: async () => ({ marker: "octokit" }),
    botHandles: ["kodiai", "claude"],
    ...overrides,
  } as any;
}

describe("recordMentionPostExecutionTelemetry", () => {
  test("returns skipped Result status when telemetry is disabled", async () => {
    const result = await recordMentionPostExecutionTelemetry(makeParams({ telemetryEnabled: false }));

    expect(result).toEqual({
      ok: true,
      value: {
        telemetryRecorded: false,
        costWarningStatus: "skipped",
        costWarningPublished: false,
      },
    });
  });

  test("returns ok Result status after recording telemetry and checking cost warning", async () => {
    const result = await recordMentionPostExecutionTelemetry(makeParams());

    expect(result).toEqual({
      ok: true,
      value: {
        telemetryRecorded: true,
        costWarningStatus: "skipped",
        costWarningPublished: false,
      },
    });
  });

  test("returns err when telemetry recording reports a write failure", async () => {
    const failure = new Error("record failed");

    const result = await recordMentionPostExecutionTelemetry(
      makeParams({
        telemetryStore: {
          recordRateLimitEvent: async () => undefined,
          record: async () => {
            throw failure;
          },
          recordPromptSections: async () => undefined,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBeInstanceOf(MentionExecutionTelemetryError);
      if (!(result.err instanceof MentionExecutionTelemetryError)) return;
      expect(result.err.failures).toEqual([{ stage: "executionTelemetry", error: failure }]);
    }
  });
});
