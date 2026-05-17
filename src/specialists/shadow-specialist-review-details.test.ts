import { describe, expect, test } from "bun:test";

import { normalizeShadowSpecialistOutput } from "./shadow-specialist.ts";
import { projectShadowSpecialistMetrics } from "./shadow-specialist-metrics.ts";
import {
  buildShadowSpecialistReviewDetailsProjection,
  formatShadowSpecialistReviewDetailsLine,
  type ShadowSpecialistReviewDetailsProjection,
} from "./shadow-specialist-review-details.ts";

const leakSentinels = [
  "SECRET_PROMPT_SENTINEL",
  "SECRET_MODEL_SENTINEL",
  "SECRET_TOOL_SENTINEL",
  "SECRET_BODY_SENTINEL",
  "SECRET_INLINE_SENTINEL",
  "SECRET_APPROVAL_SENTINEL",
  "SECRET_TIER_SENTINEL",
  "SECRET_FINGERPRINT_SENTINEL",
  "SECRET_DISAGREEMENT_SENTINEL",
];

function expectNoLeak(projection: ShadowSpecialistReviewDetailsProjection): void {
  const serialized = JSON.stringify(projection);
  for (const sentinel of leakSentinels) {
    expect(serialized).not.toContain(sentinel);
    expect(projection.reviewDetailsLine).not.toContain(sentinel);
  }
  expect(projection.reviewDetailsLine).not.toContain("\n");
  expect(projection.reviewDetailsLine.length).toBeLessThanOrEqual(640);
}

describe("buildShadowSpecialistReviewDetailsProjection", () => {
  test("formats triggered aggregate metrics as one bounded private Review Details line", () => {
    const metrics = projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput({
      status: "ok",
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-123",
      correlationKey: "corr-123",
      metrics: { tokenCount: 42, costUsd: 0.04, latencyMs: 250 },
      candidates: [
        { fingerprint: "SECRET_FINGERPRINT_SENTINEL-a", decision: "candidate", body: "SECRET_BODY_SENTINEL" },
        { fingerprint: "SECRET_FINGERPRINT_SENTINEL-a", decision: "candidate", inlineComment: "SECRET_INLINE_SENTINEL" },
        { fingerprint: "SECRET_DISAGREEMENT_SENTINEL", decision: "disagreement", disagreementCategory: "operator-runbook-gap" },
        { fingerprint: "dismissed", decision: "dismissed" },
      ],
      prompt: "SECRET_PROMPT_SENTINEL",
      modelOutput: "SECRET_MODEL_SENTINEL",
      toolPayload: { value: "SECRET_TOOL_SENTINEL" },
      approval: "SECRET_APPROVAL_SENTINEL",
      tierMode: "SECRET_TIER_SENTINEL",
    }));

    const projection = buildShadowSpecialistReviewDetailsProjection(metrics);

    expect(projection).toMatchObject({
      laneId: "docs-config-truth",
      status: "degraded",
      outputStatus: "degraded",
      reason: "unsafe-publication-field",
      candidateCount: 4,
      decisionCount: 4,
      decisionCounts: {
        candidate: 1,
        duplicate: 1,
        disagreement: 1,
        dismissed: 1,
        unclassifiable: 0,
      },
      duplicateCount: 1,
      disagreementCount: 1,
      dismissedCount: 1,
      unclassifiableCount: 0,
      truncatedCandidateCount: 0,
      metricAvailability: {
        tokenCount: "available",
        costUsd: "available",
        latencyMs: "available",
      },
      tokenCountAvailable: true,
      costAvailable: true,
      latencyMsAvailable: true,
      deliveryId: "delivery-123",
      reviewOutputKey: "review-output-123",
      correlationKey: "corr-123",
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
    expect(projection.reviewDetailsLine).toContain("Shadow specialist: lane=docs-config-truth status=degraded");
    expect(projection.reviewDetailsLine).toContain("decisionCounts=candidate:1,duplicate:1,disagreement:1,dismissed:1,unclassifiable:0");
    expect(projection.reviewDetailsLine).toContain("metricAvailability=token:y,cost:y,latency:y");
    expect(projection.reviewDetailsLine).toContain("reviewOutputKey=review-output-123");
    expect(projection.reviewDetailsLine).toContain("deliveryId=delivery-123");
    expect(projection.reviewDetailsLine).toContain("correlationKey=corr-123");
    expect(projection.reviewDetailsLine).toContain("visiblePublicationDenied=true");
    expect(projection.reviewDetailsLine).toContain("approvalPublicationDenied=true");
    expectNoLeak(projection);
  });

  test("keeps skipped and not-triggered aggregates compact with unavailable metrics and null identifiers", () => {
    const metrics = projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput({
      status: "skipped",
      skipReason: "not-applicable",
    }));

    const projection = buildShadowSpecialistReviewDetailsProjection(metrics);

    expect(projection).toMatchObject({
      status: "skipped",
      outputStatus: "skipped",
      reason: "not-applicable",
      deliveryId: null,
      reviewOutputKey: null,
      correlationKey: null,
      candidateCount: 0,
      decisionCount: 0,
      decisionCounts: {
        candidate: 0,
        duplicate: 0,
        disagreement: 0,
        dismissed: 0,
        unclassifiable: 0,
      },
      metricAvailability: {
        tokenCount: "unavailable",
        costUsd: "unavailable",
        latencyMs: "unavailable",
      },
      tokenCountAvailable: false,
      costAvailable: false,
      latencyMsAvailable: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
    });
    expect(projection.reviewDetailsLine).toContain("reviewOutputKey=none");
    expect(projection.reviewDetailsLine).toContain("deliveryId=none");
    expect(projection.reviewDetailsLine).toContain("correlationKey=none");
    expect(projection.reviewDetailsLine).toContain("metricAvailability=token:n,cost:n,latency:n");
    expectNoLeak(projection);
  });

  test("sanitizes degraded reasons and correlation fields while capping the compact line", () => {
    const projection = buildShadowSpecialistReviewDetailsProjection({
      laneId: "docs-config-truth\nSECRET_PROMPT_SENTINEL",
      status: "degraded",
      reason: `unsafe\n${"x".repeat(200)}\u0007SECRET_BODY_SENTINEL`,
      candidateCount: 3,
      decisionCount: 3,
      decisionCounts: {
        candidate: 1,
        duplicate: 0,
        disagreement: 1,
        dismissed: 0,
        unclassifiable: 1,
      },
      duplicateCount: 0,
      disagreementCount: 1,
      dismissedCount: 0,
      unclassifiableCount: 1,
      truncatedCandidateCount: 99,
      metricAvailability: { tokenCount: "available", costUsd: "unavailable", latencyMs: "available" },
      deliveryId: `delivery\n${"d".repeat(200)}`,
      reviewOutputKey: `review\r${"r".repeat(200)}`,
      correlationKey: `corr\t${"c".repeat(200)}`,
      redactionFlags: {
        unsafeFieldCount: 4,
        discardedRawPayload: true,
        discardedPublicationFields: true,
        discardedApprovalFields: true,
      },
    } as unknown as Parameters<typeof buildShadowSpecialistReviewDetailsProjection>[0]);
    expect(projection.status).toBe("degraded");
    expect(projection.reason).toHaveLength(96);
    expect(projection.reason).not.toContain("\n");
    expect(projection.deliveryId).toHaveLength(128);
    expect(projection.reviewOutputKey).toHaveLength(128);
    expect(projection.correlationKey).toHaveLength(128);
    expect(projection.reviewDetailsLine.length).toBeLessThanOrEqual(640);
    expect(projection.reviewDetailsLine).not.toContain("\n");
    expect(projection.reviewDetailsLine).not.toContain("\r");
    expect(projection.reviewDetailsLine).not.toContain("\t");
    expect(projection.reviewDetailsLine).toContain("correlationKey=corr");
    expect(projection.reviewDetailsLine).toContain("deliveryId=delivery");
    expect(projection.reviewDetailsLine).toContain("reviewOutputKey=review");
    expect(projection.reviewDetailsLine).toContain("redacted=raw:y,publication:y,approval:y,unsafe:4");
    expectNoLeak(projection);
  });

  test("degrades malformed aggregate fields to safe unavailable values without throwing", () => {
    const projection = buildShadowSpecialistReviewDetailsProjection({
      laneId: 123,
      status: "published",
      reason: { nested: "SECRET_MODEL_SENTINEL" },
      candidateCount: -1,
      decisionCount: Number.NaN,
      decisionCounts: {
        candidate: 1.5,
        duplicate: -3,
        disagreement: "SECRET_DISAGREEMENT_SENTINEL",
        dismissed: 2,
        unclassifiable: Number.POSITIVE_INFINITY,
      },
      duplicateCount: "SECRET_FINGERPRINT_SENTINEL",
      disagreementCount: null,
      dismissedCount: 2,
      unclassifiableCount: undefined,
      truncatedCandidateCount: -20,
      metricAvailability: {
        tokenCount: "SECRET_PROMPT_SENTINEL",
        costUsd: "available",
        latencyMs: null,
      },
      deliveryId: null,
      reviewOutputKey: undefined,
      correlationKey: 42,
      redactionFlags: {
        unsafeFieldCount: -1,
        discardedRawPayload: "yes",
        discardedPublicationFields: true,
        discardedApprovalFields: 1,
      },
      rawPayload: "SECRET_TOOL_SENTINEL",
      commentBody: "SECRET_BODY_SENTINEL",
      approval: "SECRET_APPROVAL_SENTINEL",
      tierMode: "SECRET_TIER_SENTINEL",
    } as unknown as Parameters<typeof buildShadowSpecialistReviewDetailsProjection>[0]);

    expect(projection).toMatchObject({
      laneId: null,
      status: "unclassifiable",
      outputStatus: "unclassifiable",
      reason: null,
      candidateCount: 0,
      decisionCount: 0,
      decisionCounts: {
        candidate: 0,
        duplicate: 0,
        disagreement: 0,
        dismissed: 2,
        unclassifiable: 0,
      },
      duplicateCount: 0,
      disagreementCount: 0,
      dismissedCount: 2,
      unclassifiableCount: 0,
      truncatedCandidateCount: 0,
      metricAvailability: {
        tokenCount: "unavailable",
        costUsd: "available",
        latencyMs: "unavailable",
      },
      tokenCountAvailable: false,
      costAvailable: true,
      latencyMsAvailable: false,
      deliveryId: null,
      reviewOutputKey: null,
      correlationKey: null,
      redactionFlags: {
        unsafeFieldCount: 0,
        discardedRawPayload: false,
        discardedPublicationFields: true,
        discardedApprovalFields: false,
      },
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
      rawContentFieldCount: 0,
      candidateBodyFieldCount: 0,
      githubPublicationFieldCount: 0,
      approvalFieldCount: 0,
    });
    expectNoLeak(projection);
  });

  test("null aggregate input becomes degraded unavailable evidence with no invented proof keys", () => {
    const projection = buildShadowSpecialistReviewDetailsProjection(null);

    expect(projection).toMatchObject({
      laneId: null,
      status: "degraded",
      outputStatus: "degraded",
      reason: "malformed-shadow-specialist-metrics",
      deliveryId: null,
      reviewOutputKey: null,
      correlationKey: null,
      candidateCount: 0,
      decisionCount: 0,
      tokenCountAvailable: false,
      costAvailable: false,
      latencyMsAvailable: false,
      visiblePublicationDenied: true,
      approvalPublicationDenied: true,
    });
    expect(projection.reviewDetailsLine).toContain("reviewOutputKey=none");
    expect(projection.reviewDetailsLine).toContain("deliveryId=none");
    expect(projection.reviewDetailsLine).toContain("correlationKey=none");
    expectNoLeak(projection);
  });
});

describe("formatShadowSpecialistReviewDetailsLine", () => {
  test("formats an already-built projection deterministically", () => {
    const projection = buildShadowSpecialistReviewDetailsProjection(projectShadowSpecialistMetrics(normalizeShadowSpecialistOutput({
      status: "ok",
      candidates: [{ fingerprint: "candidate", decision: "candidate" }],
    })));

    expect(formatShadowSpecialistReviewDetailsLine(projection)).toBe(projection.reviewDetailsLine);
  });
});
