import { describe, expect, test } from "bun:test";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import {
  buildOrderedReviewPhaseSummary,
  buildQueueWaitPhase,
  buildReviewDetailsPhaseTimingSummary,
  completeReviewRetrievalContextPhaseTiming,
  completeReviewPublicationPhaseTiming,
  formatTimeoutErrorDetail,
  isValidQueueWaitMetadata,
  recordReviewExecutorPhaseTimings,
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

describe("completeReviewPublicationPhaseTiming", () => {
  test("records completed publication duration when the publication phase started", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();

    const recorded = completeReviewPublicationPhaseTiming({
      phases,
      publicationPhaseStartedAt: 1000,
      now: () => 1250,
    });

    expect(recorded).toBeTrue();
    expect(phases.get("publication")).toEqual({
      name: "publication",
      status: "completed",
      durationMs: 250,
    });
  });

  test("does not record publication timing before the publication phase starts", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();

    const recorded = completeReviewPublicationPhaseTiming({
      phases,
      now: () => 1250,
    });

    expect(recorded).toBeFalse();
    expect(phases.has("publication")).toBeFalse();
  });

  test("clamps negative publication duration to zero", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();

    completeReviewPublicationPhaseTiming({
      phases,
      publicationPhaseStartedAt: 1250,
      now: () => 1000,
    });

    expect(phases.get("publication")?.durationMs).toBe(0);
  });
});

describe("completeReviewRetrievalContextPhaseTiming", () => {
  test("records completed retrieval/context duration from the phase start", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();

    completeReviewRetrievalContextPhaseTiming({
      phases,
      retrievalPhaseStartedAt: 1000,
      now: () => 1225,
    });

    expect(phases.get("retrieval/context assembly")).toEqual({
      name: "retrieval/context assembly",
      status: "completed",
      durationMs: 225,
    });
  });

  test("clamps negative retrieval/context duration to zero", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();

    completeReviewRetrievalContextPhaseTiming({
      phases,
      retrievalPhaseStartedAt: 1225,
      now: () => 1000,
    });

    expect(phases.get("retrieval/context assembly")?.durationMs).toBe(0);
  });
});

describe("recordReviewExecutorPhaseTimings", () => {
  test("records executor phases into the review phase map", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();

    recordReviewExecutorPhaseTimings(phases, [
      { name: "executor handoff", status: "completed", durationMs: 20 },
      { name: "remote runtime", status: "completed", durationMs: 100 },
    ]);

    expect(phases.get("executor handoff")).toEqual({
      name: "executor handoff",
      status: "completed",
      durationMs: 20,
    });
    expect(phases.get("remote runtime")).toEqual({
      name: "remote runtime",
      status: "completed",
      durationMs: 100,
    });
  });

  test("can preserve existing phase entries during finalization", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>([
      ["executor handoff", { name: "executor handoff", status: "completed", durationMs: 20 }],
    ]);

    recordReviewExecutorPhaseTimings(
      phases,
      [{ name: "executor handoff", status: "degraded", durationMs: 200, detail: "late fallback" }],
      { overwrite: false },
    );

    expect(phases.get("executor handoff")).toEqual({
      name: "executor handoff",
      status: "completed",
      durationMs: 20,
    });
  });
});
