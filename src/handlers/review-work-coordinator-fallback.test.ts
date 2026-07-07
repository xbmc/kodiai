import { describe, expect, mock, test } from "bun:test";
import { createReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import { resolveReviewWorkCoordinator } from "./review-work-coordinator-fallback.ts";

describe("resolveReviewWorkCoordinator", () => {
  test("uses an injected coordinator without logging fallback degradation", () => {
    const injected = createReviewWorkCoordinator();
    const warn = mock(() => undefined);

    const coordinator = resolveReviewWorkCoordinator({
      injected,
      handler: "review",
      logger: { warn },
    });

    expect(coordinator).toBe(injected);
    expect(warn).not.toHaveBeenCalled();
  });

  test("creates a handler-local fallback coordinator and logs degraded coordination", () => {
    const warn = mock(() => undefined);

    const coordinator = resolveReviewWorkCoordinator({
      injected: undefined,
      handler: "mention",
      logger: { warn },
    });

    const claim = coordinator.claim({
      familyKey: "owner/repo#1",
      source: "explicit-review",
      lane: "interactive-review",
      deliveryId: "delivery-1",
      phase: "claimed",
    });

    expect(claim.familyKey).toBe("owner/repo#1");
    expect(warn).toHaveBeenCalledWith(
      {
        gate: "review-family-coordinator",
        gateResult: "private-fallback",
        coordinationScope: "handler-local",
        handler: "mention",
      },
      "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );
  });
});
