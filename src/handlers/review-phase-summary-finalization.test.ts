import { describe, expect, mock, test } from "bun:test";
import type { ReviewPhaseName, ReviewPhaseTiming } from "../execution/types.ts";
import { finalizeReviewPhaseSummary } from "./review-phase-summary-finalization.ts";

describe("finalizeReviewPhaseSummary", () => {
  test("completes publication phase and logs ordered phase summary when review work started", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>([
      ["workspace preparation", {
        name: "workspace preparation",
        status: "completed",
        durationMs: 20,
      }],
    ]);
    const info = mock(() => undefined);

    finalizeReviewPhaseSummary({
      reviewPhaseTimings: phases,
      workspacePhaseStartedAt: 1_000,
      retrievalPhaseStartedAt: undefined,
      publicationPhaseStartedAt: 1_100,
      totalPhaseStartAt: 900,
      executorResult: {
        conclusion: "success",
        stopReason: "end_turn",
      },
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-key",
      installationId: 123,
      repo: "acme/widgets",
      prNumber: 42,
      reviewOutputPublished: true,
      reviewPublishResolution: "executor",
      reviewPublishFallbackDelivery: undefined,
      logger: { info },
      now: () => 1_150,
    });

    expect(phases.get("publication")).toEqual({
      name: "publication",
      status: "completed",
      durationMs: 50,
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-1",
        reviewOutputKey: "review-output-key",
        installationId: 123,
        repo: "acme/widgets",
        prNumber: 42,
        conclusion: "success",
        published: true,
        publishResolution: "executor",
        totalDurationMs: 250,
        phases: expect.arrayContaining([
          expect.objectContaining({
            name: "workspace preparation",
            status: "completed",
          }),
          expect.objectContaining({
            name: "publication",
            status: "completed",
            durationMs: 50,
          }),
        ]),
      }),
      "Review phase timing summary",
    );
  });

  test("skips summary logging without delivery id or output key and swallows logger failures", () => {
    const phases = new Map<ReviewPhaseName, ReviewPhaseTiming>();
    const throwingInfo = mock(() => {
      throw new Error("logger failed");
    });

    expect(() => finalizeReviewPhaseSummary({
      reviewPhaseTimings: phases,
      workspacePhaseStartedAt: undefined,
      retrievalPhaseStartedAt: undefined,
      publicationPhaseStartedAt: undefined,
      totalPhaseStartAt: 900,
      executorResult: {
        conclusion: "failure",
        stopReason: undefined,
        failureSubtype: undefined,
      },
      deliveryId: "",
      reviewOutputKey: "",
      installationId: 123,
      repo: "acme/widgets",
      prNumber: 42,
      reviewOutputPublished: false,
      reviewPublishResolution: "none",
      logger: { info: throwingInfo },
      now: () => 1_150,
    })).not.toThrow();

    expect(throwingInfo).not.toHaveBeenCalled();
  });
});
