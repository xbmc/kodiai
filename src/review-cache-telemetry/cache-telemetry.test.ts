import { describe, expect, test } from "bun:test";

import {
  aggregateReviewCacheTelemetryObservations,
  evaluateReviewCacheTelemetryFixture,
  type ReviewCacheTelemetryObservation,
} from "./cache-telemetry.ts";

const VALID_OBSERVATIONS: ReviewCacheTelemetryObservation[] = [
  {
    cacheSurface: "review-derived-prompt",
    status: "hit",
    reason: "safe-reuse",
    deliveryId: "delivery-cache-001",
    repo: "octo/example",
    prNumber: 101,
    fingerprintVersion: "review-cache-fp-v1",
    safetySignalNames: ["base-ref", "head-ref", "prompt-schema"],
  },
  {
    cacheSurface: "retrieval-query-embedding",
    status: "miss",
    reason: "cache-miss",
    deliveryId: "delivery-cache-002",
    repo: "octo/example",
    prNumber: 102,
  },
  {
    cacheSurface: "retrieval-query-embedding",
    status: "degraded",
    reason: "incomplete-fingerprint",
    deliveryId: "delivery-cache-003",
    repo: "octo/example",
    prNumber: 103,
    missingSignalNames: ["base-ref"],
  },
  {
    cacheSurface: "review-derived-prompt",
    status: "bypass",
    reason: "disabled-cache",
    deliveryId: "delivery-cache-004",
    repo: "octo/example",
    prNumber: 104,
  },
];

function validFixture(): Record<string, unknown> {
  return {
    generatedAt: "2026-05-18T02:55:00.000Z",
    cacheTelemetryObservations: VALID_OBSERVATIONS,
    cacheTelemetrySummary: aggregateReviewCacheTelemetryObservations(VALID_OBSERVATIONS),
  };
}

describe("review cache telemetry contract", () => {
  test("aggregates observations deterministically by surface, status, and reason", () => {
    const totals = aggregateReviewCacheTelemetryObservations(VALID_OBSERVATIONS);

    expect(totals).toMatchObject({
      observationCount: 4,
      deliveryCount: 4,
      bookkeepingErrorCount: 0,
      surfaceCounts: {
        "review-derived-prompt": 2,
        "retrieval-query-embedding": 2,
      },
      statusCounts: {
        hit: 1,
        miss: 1,
        degraded: 1,
        bypass: 1,
      },
      reasonCounts: {
        "safe-reuse": 1,
        "cache-miss": 1,
        "incomplete-fingerprint": 1,
        "disabled-cache": 1,
      },
    });
    expect(totals.surfaceStatusCounts["review-derived-prompt"]).toEqual({ hit: 1, miss: 0, degraded: 0, bypass: 1 });
    expect(totals.missingSignalNames).toEqual(["base-ref"]);
  });

  test("passes a text-free fixture with deterministic declared totals", () => {
    const evaluation = evaluateReviewCacheTelemetryFixture(validFixture());

    expect(evaluation.status).toBe("pass");
    expect(evaluation.checks.map((check) => check.id)).toEqual([
      "fixture.shape",
      "cache-observations.present",
      "vocabulary.bounded",
      "observation-identity.unique",
      "reuse-safety.valid",
      "totals.deterministic",
      "redaction.safe",
    ]);
  });

  test("fails malformed shape, unknown vocabulary, and duplicate delivery/surface rows", () => {
    const fixture = validFixture();
    fixture.cacheTelemetryObservations = [
      ...VALID_OBSERVATIONS,
      {
        cacheSurface: "unknown-cache-surface",
        status: "maybe",
        reason: "unsafe-reason",
        deliveryId: "delivery-cache-001",
        repo: "octo/example",
      },
      {
        cacheSurface: "review-derived-prompt",
        status: "miss",
        reason: "cache-miss",
        deliveryId: "delivery-cache-001",
        repo: "octo/example",
      },
    ];

    const evaluation = evaluateReviewCacheTelemetryFixture(fixture);
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "vocabulary.bounded")?.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "observation-identity.unique")?.status).toBe("fail");
    expect(issues).toContain("cacheSurface is not allowed");
    expect(issues).toContain("status is not allowed");
    expect(issues).toContain("reason is not allowed");
    expect(issues).toContain("duplicates deliveryId/cacheSurface without attemptOrdinal");
  });

  test("allows duplicate delivery/surface rows only when attempt ordinal disambiguates them", () => {
    const observations: ReviewCacheTelemetryObservation[] = [
      {
        cacheSurface: "review-derived-prompt",
        status: "miss",
        reason: "cache-miss",
        deliveryId: "delivery-cache-duplicate",
        repo: "octo/example",
        attemptOrdinal: 0,
      },
      {
        cacheSurface: "review-derived-prompt",
        status: "bypass",
        reason: "disabled-cache",
        deliveryId: "delivery-cache-duplicate",
        repo: "octo/example",
        attemptOrdinal: 1,
      },
    ];
    const evaluation = evaluateReviewCacheTelemetryFixture({
      cacheTelemetryObservations: observations,
      cacheTelemetrySummary: aggregateReviewCacheTelemetryObservations(observations),
    });

    expect(evaluation.status).toBe("pass");
  });

  test("fails unsafe reuse boundaries for hit, bypass, degraded, and impossible counters", () => {
    const observations = [
      {
        cacheSurface: "review-derived-prompt",
        status: "hit",
        reason: "cache-miss",
        deliveryId: "delivery-hit-no-fp",
        repo: "octo/example",
      },
      {
        cacheSurface: "retrieval-query-embedding",
        status: "bypass",
        deliveryId: "delivery-bypass-no-reason",
        repo: "octo/example",
      },
      {
        cacheSurface: "retrieval-query-embedding",
        status: "degraded",
        reason: "bookkeeping-failure",
        deliveryId: "delivery-degraded-no-count",
        repo: "octo/example",
        bookkeepingErrorCount: 0,
      },
      {
        cacheSurface: "review-derived-prompt",
        status: "degraded",
        reason: "incomplete-fingerprint",
        deliveryId: "delivery-bad-signal",
        repo: "octo/example",
        missingSignalNames: ["not bounded signal name"],
      },
    ];

    const evaluation = evaluateReviewCacheTelemetryFixture({
      cacheTelemetryObservations: observations,
      cacheTelemetrySummary: aggregateReviewCacheTelemetryObservations(observations as ReviewCacheTelemetryObservation[]),
    });
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "reuse-safety.valid")?.status).toBe("fail");
    expect(issues).toContain("hit row is missing fingerprintVersion");
    expect(issues).toContain("hit row is missing safetySignalNames");
    expect(issues).toContain("bypass row is missing a bounded reason");
    expect(issues).toContain("bookkeeping-failure reason requires positive bookkeepingErrorCount");
    expect(issues).toContain("must be a bounded signal name");
  });

  test("fails impossible declared counters", () => {
    const fixture = validFixture();
    fixture.cacheTelemetrySummary = {
      ...(fixture.cacheTelemetrySummary as Record<string, unknown>),
      statusCounts: {
        hit: 999,
        miss: 1,
        degraded: 1,
        bypass: 1,
      },
    };

    const evaluation = evaluateReviewCacheTelemetryFixture(fixture);
    const issues = evaluation.checks.flatMap((check) => check.issues).join("\n");

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "totals.deterministic")?.status).toBe("fail");
    expect(issues).toContain("cacheTelemetrySummary.statusCounts.hit expected 1 but found 999");
  });

  test("redaction rejects raw text fields, raw fingerprint fields, and secret-like values without echoing payloads", () => {
    const fixture = validFixture();
    fixture.rawPrompt = "RAW PROMPT SHOULD NOT APPEAR";
    fixture.diff = "DIFF SHOULD NOT APPEAR";
    fixture.fingerprint = "0123456789abcdef SHOULD NOT APPEAR";
    fixture.token = "sk-abc123 SHOULD NOT APPEAR";
    fixture.boundedLabel = "x".repeat(200);

    const evaluation = evaluateReviewCacheTelemetryFixture(fixture);
    const serialized = JSON.stringify(evaluation);

    expect(evaluation.status).toBe("fail");
    expect(evaluation.checks.find((check) => check.id === "redaction.safe")?.status).toBe("fail");
    expect(serialized).toContain("rawPrompt is a forbidden raw-text field");
    expect(serialized).toContain("fingerprint is a forbidden raw-fingerprint field");
    expect(serialized).not.toContain("RAW PROMPT SHOULD NOT APPEAR");
    expect(serialized).not.toContain("DIFF SHOULD NOT APPEAR");
    expect(serialized).not.toContain("0123456789abcdef SHOULD NOT APPEAR");
    expect(serialized).not.toContain("sk-abc123 SHOULD NOT APPEAR");
    expect(serialized).not.toContain("x".repeat(200));
  });
});
