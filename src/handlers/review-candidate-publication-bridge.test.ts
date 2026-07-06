import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import {
  projectReviewHandlerCandidatePublicationBridgeEvidence,
} from "../issue-131/review-handler-publication-bridge.ts";
import {
  resolveReviewHandlerCandidatePublicationBridge,
} from "./review-candidate-publication-bridge.ts";

function makeProjection() {
  return projectReviewHandlerCandidatePublicationBridgeEvidence({
    evidenceSummary: null,
    deliveryId: "delivery-1",
    reviewOutputKey: "review-output-1",
    upstreamCorrelationKey: "correlation-1",
  });
}

describe("resolveReviewHandlerCandidatePublicationBridge", () => {
  test("logs and returns projected candidate publication bridge evidence", () => {
    const infoEntries: unknown[] = [];
    const logger = {
      info: (fields: unknown) => infoEntries.push(fields),
      warn: () => {
        throw new Error("unexpected warning");
      },
    } as unknown as Logger;
    const projection = makeProjection();

    const result = resolveReviewHandlerCandidatePublicationBridge({
      logger,
      baseLog: { deliveryId: "delivery-1" },
      evidenceSummary: undefined,
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
      upstreamCorrelationKey: "correlation-1",
      project: () => projection,
    });

    expect(result).toBe(projection);
    expect(infoEntries).toHaveLength(1);
    expect(infoEntries[0]).toMatchObject({
      deliveryId: "delivery-1",
      gate: "m072-review-handler-publication-bridge",
      ...projection.logFields,
    });
  });

  test("degrades to null-evidence projection when projection throws", () => {
    const warnEntries: unknown[] = [];
    const infoEntries: unknown[] = [];
    const logger = {
      info: (fields: unknown) => infoEntries.push(fields),
      warn: (fields: unknown) => warnEntries.push(fields),
    } as unknown as Logger;
    const degradedProjection = makeProjection();
    const calls: unknown[] = [];

    const result = resolveReviewHandlerCandidatePublicationBridge({
      logger,
      baseLog: { deliveryId: "delivery-1" },
      evidenceSummary: undefined,
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-1",
      upstreamCorrelationKey: "correlation-1",
      project: (input) => {
        calls.push(input.evidenceSummary);
        if (calls.length === 1) throw new Error("boom");
        return degradedProjection;
      },
    });

    expect(result).toBe(degradedProjection);
    expect(calls).toEqual([undefined, null]);
    expect(warnEntries).toHaveLength(1);
    expect(warnEntries[0]).toMatchObject({
      gate: "m072-review-handler-publication-bridge",
      gateResult: "degraded",
      reason: "projection-exception",
      ...degradedProjection.logFields,
    });
    expect(infoEntries).toHaveLength(1);
    expect(infoEntries[0]).toMatchObject({
      gate: "m072-review-handler-publication-bridge",
      ...degradedProjection.logFields,
    });
  });
});
