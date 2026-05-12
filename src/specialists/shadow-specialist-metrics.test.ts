import { describe, expect, test } from "bun:test";

import {
  DOCS_CONFIG_TRUTH_LANE_ID,
  normalizeShadowSpecialistOutput,
} from "./shadow-specialist.ts";
import { projectShadowSpecialistMetrics } from "./shadow-specialist-metrics.ts";
import { runShadowSpecialistSubflow } from "./shadow-specialist-subflow.ts";

const operatorPath = "docs/operators/review-details.md";

describe("projectShadowSpecialistMetrics", () => {
  test("projects normalized output into bounded private aggregate metrics only", () => {
    const output = normalizeShadowSpecialistOutput({
      status: "ok",
      deliveryId: "delivery-private",
      reviewOutputKey: "review-output-private",
      correlationKey: "corr-private",
      metrics: { tokenCount: 123, costUsd: 0.25, latencyMs: 45 },
      candidates: [
        { fingerprint: "candidate-fingerprint-a", decision: "candidate", body: "must not publish" },
        { fingerprint: "duplicate-fingerprint", decision: "candidate" },
        { fingerprint: "duplicate-fingerprint", decision: "candidate" },
        { fingerprint: "disagreement-fingerprint", decision: "disagreement", disagreementCategory: "operator-runbook-gap" },
        { fingerprint: "dismissed-fingerprint", decision: "dismissed" },
        { fingerprint: "bad-decision-fingerprint", decision: "ship-it", inlineComment: "visible comment" },
      ],
      prompt: "raw prompt secret",
      modelOutput: "raw model text",
      toolPayload: { body: "tool body" },
      approval: true,
    });

    const projection = projectShadowSpecialistMetrics(output);

    expect(projection).toEqual({
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      status: "degraded",
      reason: "unsafe-publication-field",
      deliveryId: "delivery-private",
      reviewOutputKey: "review-output-private",
      correlationKey: "corr-private",
      candidateCount: 6,
      decisionCount: 6,
      decisionCounts: {
        candidate: 2,
        duplicate: 1,
        disagreement: 1,
        dismissed: 1,
        unclassifiable: 1,
      },
      duplicateCount: 1,
      disagreementCount: 1,
      dismissedCount: 1,
      unclassifiableCount: 1,
      truncatedCandidateCount: 0,
      metricAvailability: {
        tokenCount: "available",
        costUsd: "available",
        latencyMs: "available",
      },
      tokenCountAvailable: true,
      costAvailable: true,
      latencyMsAvailable: true,
      redactionFlags: {
        unsafeFieldCount: 7,
        discardedRawPayload: true,
        discardedPublicationFields: true,
        discardedApprovalFields: true,
      },
      privateOnly: true,
      shadowOnly: true,
      publishesFindings: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      rawContentFieldCount: 0,
      candidateBodyFieldCount: 0,
      githubPublicationFieldCount: 0,
      approvalFieldCount: 0,
      specialistContentIncluded: false,
      candidateFingerprintsIncluded: false,
      candidateBodiesIncluded: false,
      rawModelOutputIncluded: false,
      toolPayloadIncluded: false,
      approvalFieldsIncluded: false,
      tierModeIncluded: false,
    });

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("candidate-fingerprint");
    expect(serialized).not.toContain("must not publish");
    expect(serialized).not.toContain("visible comment");
    expect(serialized).not.toContain("raw prompt secret");
    expect(serialized).not.toContain("raw model text");
    expect(serialized).not.toContain("tool body");
    expect(serialized).not.toContain("ship-it");
    expect(serialized).not.toContain("operator-runbook-gap");
  });

  test("accepts a subflow result and preserves trigger failure reason without content", async () => {
    const result = await runShadowSpecialistSubflow({
      changedPaths: [operatorPath],
      deliveryId: "delivery-error",
      reviewOutputKey: "review-output-error",
      correlationKey: "corr-error",
      runner: () => {
        throw new Error("runner failure with sensitive body");
      },
    });

    const projection = projectShadowSpecialistMetrics(result);

    expect(projection).toMatchObject({
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      status: "error",
      reason: "runner-error",
      deliveryId: "delivery-error",
      reviewOutputKey: "review-output-error",
      correlationKey: "corr-error",
      candidateCount: 0,
      decisionCount: 0,
      duplicateCount: 0,
      disagreementCount: 0,
      metricAvailability: {
        tokenCount: "unavailable",
        costUsd: "unavailable",
        latencyMs: "unavailable",
      },
      privateOnly: true,
      shadowOnly: true,
      publishesFindings: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
    });
    expect(JSON.stringify(projection)).not.toContain("runner failure");
  });

  test("reports truncated, duplicate, disagreement, dismissed, and unclassifiable aggregates", () => {
    const candidates = Array.from({ length: 30 }, (_value, index) => ({
      fingerprint: index === 2 ? "fingerprint-1" : `fingerprint-${index}`,
      decision: index === 3
        ? "disagreement"
        : index === 4
          ? "dismissed"
          : index === 5
            ? "unknown"
            : "candidate",
      disagreementCategory: index === 3 ? "docs-config-conflict" : undefined,
      path: index === 6 ? "docs/operators/review-details.md" : undefined,
      line: index === 6 ? 10 : undefined,
      suggestion: index === 6 ? "do not expose" : undefined,
    }));

    const projection = projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput({
      status: "ok",
      candidates,
    }));

    expect(projection).toMatchObject({
      status: "degraded",
      reason: "unsafe-publication-field",
      candidateCount: 25,
      decisionCount: 25,
      duplicateCount: 1,
      disagreementCount: 1,
      dismissedCount: 1,
      unclassifiableCount: 1,
      truncatedCandidateCount: 5,
      visiblePublicationDenied: true,
      githubPublicationFieldCount: 0,
      candidateBodyFieldCount: 0,
    });
    expect(projection.decisionCounts).toEqual({
      candidate: 21,
      duplicate: 1,
      disagreement: 1,
      dismissed: 1,
      unclassifiable: 1,
    });
    expect(JSON.stringify(projection)).not.toContain("fingerprint-");
    expect(JSON.stringify(projection)).not.toContain("do not expose");
  });

  test("keeps empty skipped and unclassifiable outputs available as private unavailable metrics", () => {
    const skipped = projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput({
      status: "skipped",
      skipReason: "no-candidates",
      deliveryId: "delivery-skip",
    }));
    const unclassifiable = projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput(null));

    expect(skipped).toMatchObject({
      status: "skipped",
      reason: "no-candidates",
      deliveryId: "delivery-skip",
      candidateCount: 0,
      decisionCounts: {
        candidate: 0,
        duplicate: 0,
        disagreement: 0,
        dismissed: 0,
        unclassifiable: 0,
      },
      tokenCountAvailable: false,
      costAvailable: false,
      latencyMsAvailable: false,
      privateOnly: true,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
    });

    expect(unclassifiable).toMatchObject({
      status: "unclassifiable",
      reason: "invalid-output-shape",
      candidateCount: 0,
      privateOnly: true,
      publishesFindings: false,
    });
  });
});
