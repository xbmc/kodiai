import { describe, expect, test } from "bun:test";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import {
  buildOrderedReviewPhaseSummary,
  buildQueueWaitPhase,
  buildReviewDetailsPhaseTimingSummary,
  formatTimeoutErrorDetail,
  isValidQueueWaitMetadata,
} from "./review-phase-timing.ts";

describe("isValidQueueWaitMetadata", () => {
  test("accepts consistent queue wait metadata", () => {
    expect(isValidQueueWaitMetadata({ queuedAtMs: 1000, startedAtMs: 1500, waitMs: 500 })).toBeTrue();
    expect(isValidQueueWaitMetadata({ queuedAtMs: 1000, startedAtMs: 1400, waitMs: 500 })).toBeFalse();
  });
});

describe("buildQueueWaitPhase", () => {
  test("returns completed queue wait timing for valid metadata", () => {
    expect(buildQueueWaitPhase({ queuedAtMs: 0, startedAtMs: 250, waitMs: 250 })).toEqual({
      name: "queue wait",
      status: "completed",
      durationMs: 250,
    });
  });
});

describe("formatTimeoutErrorDetail", () => {
  test("includes timeout budget breakdown when estimate is present", () => {
    expect(formatTimeoutErrorDetail({
      totalTimeoutSeconds: 900,
      complexityInfo: "large diff",
      hasReviewOutput: true,
      timeoutEstimate: {
        remoteRuntimeBudgetSeconds: 840,
        infraOverheadBudgetSeconds: 60,
        totalTimeoutSeconds: 900,
      },
    })).toContain("remote runtime 840s");
  });
});

describe("buildReviewDetailsPhaseTimingSummary", () => {
  test("orders phases and captures in-progress publication timing", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>([
      ["queue wait", { name: "queue wait", status: "completed", durationMs: 10 }],
    ]);

    const summary = buildReviewDetailsPhaseTimingSummary({
      phases,
      publicationPhaseStartedAt: 1000,
      totalPhaseStartAt: 900,
      now: () => 1100,
    });

    expect(summary.totalDurationMs).toBe(200);
    expect(summary.phases.map((phase) => phase.name)).toEqual([
      "queue wait",
      "workspace preparation",
      "retrieval/context assembly",
      "executor handoff",
      "remote runtime",
      "publication",
    ]);
    expect(summary.phases.find((phase) => phase.name === "publication")).toMatchObject({
      status: "degraded",
      durationMs: 100,
    });
  });

  test("buildOrderedReviewPhaseSummary fills missing phases as unavailable", () => {
    const ordered = buildOrderedReviewPhaseSummary(new Map());
    expect(ordered.every((phase) => phase.status === "unavailable")).toBeTrue();
    expect(ordered).toHaveLength(6);
  });
});
