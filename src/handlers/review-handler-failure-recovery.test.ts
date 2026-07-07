import { describe, expect, mock, test } from "bun:test";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import { handleReviewHandlerFailureRecovery } from "./review-handler-failure-recovery.ts";

describe("handleReviewHandlerFailureRecovery", () => {
  test("marks missing preparation phases degraded and records handler-failure publication detail", async () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();
    const logger = {
      error: mock(() => undefined),
    };
    const publishHandlerFailureError = mock(async () => ({
      phaseDetail: "posted error comment after handler failure",
    }));

    const publicationPhaseStartedAt = await handleReviewHandlerFailureRecovery({
      error: new Error("boom"),
      prNumber: 12,
      reviewPhaseTimings: phases,
      workspacePhaseStartedAt: 1_000,
      retrievalPhaseStartedAt: 1_050,
      publicationPhaseStartedAt: undefined,
      now: () => 1_100,
      logger,
      publishHandlerFailureError,
    });

    expect(publicationPhaseStartedAt).toBe(1_100);
    expect(phases.get("workspace preparation")).toEqual({
      name: "workspace preparation",
      status: "degraded",
      durationMs: 100,
      detail: "workspace preparation failed",
    });
    expect(phases.get("retrieval/context assembly")).toEqual({
      name: "retrieval/context assembly",
      status: "degraded",
      durationMs: 50,
      detail: "retrieval/context assembly failed",
    });
    expect(phases.get("publication")).toEqual({
      name: "publication",
      status: "degraded",
      durationMs: 0,
      detail: "posted error comment after handler failure",
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error), prNumber: 12 },
      "Review handler failed",
    );
    expect(publishHandlerFailureError).toHaveBeenCalledTimes(1);
  });

  test("records degraded publication detail when handler-failure publication throws", async () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>([
      ["workspace preparation", {
        name: "workspace preparation",
        status: "completed",
        durationMs: 10,
      }],
    ]);
    const logger = {
      error: mock(() => undefined),
    };
    const publishError = new Error("comment failed");

    const publicationPhaseStartedAt = await handleReviewHandlerFailureRecovery({
      error: "handler failed",
      prNumber: 99,
      reviewPhaseTimings: phases,
      workspacePhaseStartedAt: 1_000,
      retrievalPhaseStartedAt: undefined,
      publicationPhaseStartedAt: 1_075,
      now: () => 1_100,
      logger,
      publishHandlerFailureError: async () => {
        throw publishError;
      },
    });

    expect(publicationPhaseStartedAt).toBe(1_075);
    expect(phases.get("workspace preparation")).toEqual({
      name: "workspace preparation",
      status: "completed",
      durationMs: 10,
    });
    expect(phases.get("publication")).toEqual({
      name: "publication",
      status: "degraded",
      durationMs: 25,
      detail: "failed to publish error comment after handler failure",
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: publishError },
      "Failed to post error comment to PR",
    );
  });
});
