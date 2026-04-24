import { describe, expect, test } from "bun:test";
import {
  LOCKED_CACHE_SEQUENCE,
  buildDeterministicMatrix,
  buildPhase75Report,
  evaluateClosureVerification,
  parseIdentity,
  renderFinalVerdict,
  validateDeterministicMatrix,
  type Identity,
  type Phase75QueryResult,
} from "./phase75-live-ops-verification-closure.ts";

function buildFixtureMatrix() {
  return buildDeterministicMatrix({
    review: {
      prime: "review-prime",
      hit: "review-hit",
      "changed-query-miss": "review-changed",
    },
  });
}

function buildAcceptedReviewIdentities(): Identity[] {
  return [
    { deliveryId: "review-prime", eventType: "pull_request.review_requested" },
    { deliveryId: "review-hit", eventType: "pull_request.review_requested" },
    { deliveryId: "review-changed", eventType: "pull_request.review_requested" },
  ];
}

function buildQueryResult(overrides: Partial<Phase75QueryResult> = {}): Phase75QueryResult {
  return {
    executions: [
      { deliveryId: "review-prime", eventType: "pull_request.review_requested", conclusion: "success" },
      { deliveryId: "review-hit", eventType: "pull_request.review_requested", conclusion: "success" },
      { deliveryId: "review-changed", eventType: "pull_request.review_requested", conclusion: "success" },
      { deliveryId: "failopen-review-1", eventType: "pull_request.review_requested", conclusion: "success" },
    ],
    rateLimits: [
      {
        deliveryId: "review-prime",
        eventType: "pull_request.review_requested",
        cacheHitRate: 0,
        degradationPath: "none",
      },
      {
        deliveryId: "review-hit",
        eventType: "pull_request.review_requested",
        cacheHitRate: 1,
        degradationPath: "none",
      },
      {
        deliveryId: "review-changed",
        eventType: "pull_request.review_requested",
        cacheHitRate: 0,
        degradationPath: "degraded",
      },
    ],
    degradedDuplicates: [],
    ...overrides,
  };
}

describe("phase75 matrix helpers", () => {
  test("builds fixed review-only prime->hit->changed ordering", () => {
    const matrix = buildFixtureMatrix();
    expect(LOCKED_CACHE_SEQUENCE).toEqual(["prime", "hit", "changed-query-miss"]);
    expect(() => validateDeterministicMatrix(matrix)).not.toThrow();
    expect(matrix.map((step) => `${step.surface}:${step.outcome}`)).toEqual([
      "review_requested:prime",
      "review_requested:hit",
      "review_requested:changed-query-miss",
    ]);
  });

  test("rejects malformed identity format", () => {
    expect(() => parseIdentity("missing-event-type")).toThrow("must use");
    expect(parseIdentity("delivery-1:pull_request.review_requested")).toEqual({
      deliveryId: "delivery-1",
      eventType: "pull_request.review_requested",
    });
  });
});

describe("phase75 closure verification", () => {
  const degradedIdentities: Identity[] = [
    { deliveryId: "review-changed", eventType: "pull_request.review_requested" },
  ];
  const failOpenIdentities: Identity[] = [
    { deliveryId: "failopen-review-1", eventType: "pull_request.review_requested" },
  ];

  test("passes when cache matrix, degraded once-only, and fail-open completion all hold", () => {
    const report = evaluateClosureVerification(
      buildQueryResult(),
      buildFixtureMatrix(),
      buildAcceptedReviewIdentities(),
      degradedIdentities,
      failOpenIdentities,
    );

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails duplicate degraded telemetry detection when same identity appears twice", () => {
    const report = evaluateClosureVerification(
      buildQueryResult({
        degradedDuplicates: [
          { deliveryId: "review-changed", eventType: "pull_request.review_requested", count: 2 },
        ],
        rateLimits: [
          ...buildQueryResult().rateLimits,
          {
            deliveryId: "review-changed",
            eventType: "pull_request.review_requested",
            cacheHitRate: 0,
            degradationPath: "degraded",
          },
        ],
      }),
      buildFixtureMatrix(),
      buildAcceptedReviewIdentities(),
      degradedIdentities,
      failOpenIdentities,
    );

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "OPS75-ONCE-02")?.passed).toBe(false);
  });

  test("fails fail-open completion when forced-failure execution concludes with failure", () => {
    const report = evaluateClosureVerification(
      buildQueryResult({
        executions: [
          { deliveryId: "review-prime", eventType: "pull_request.review_requested", conclusion: "success" },
          { deliveryId: "review-hit", eventType: "pull_request.review_requested", conclusion: "success" },
          { deliveryId: "review-changed", eventType: "pull_request.review_requested", conclusion: "success" },
          { deliveryId: "failopen-review-1", eventType: "pull_request.review_requested", conclusion: "failed" },
        ],
      }),
      buildFixtureMatrix(),
      buildAcceptedReviewIdentities(),
      degradedIdentities,
      failOpenIdentities,
    );

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "OPS75-FAILOPEN-02")?.passed).toBe(false);
  });

  test("fails preflight check when accepted review identities do not match review matrix", () => {
    const acceptedReviewMismatch: Identity[] = [
      { deliveryId: "review-hit", eventType: "pull_request.review_requested" },
      { deliveryId: "review-prime", eventType: "pull_request.review_requested" },
      { deliveryId: "review-changed", eventType: "pull_request.review_requested" },
    ];

    const report = evaluateClosureVerification(
      buildQueryResult(),
      buildFixtureMatrix(),
      acceptedReviewMismatch,
      degradedIdentities,
      failOpenIdentities,
    );

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "OPS75-PREFLIGHT-01")?.passed).toBe(false);
  });

  test("builds fail-open preflight output when database access is missing", () => {
    const report = buildPhase75Report({
      generatedAt: "2026-04-24T00:00:00.000Z",
      accessState: "missing",
      accessDetail: "DATABASE_URL is unset.",
      verification: null,
      matrix: [],
      acceptedReviewIdentities: [],
      degradedIdentities: [],
      failOpenIdentities: [],
    });

    expect(report.preflight.databaseAccess).toBe("missing");
    expect(report.checks).toEqual([]);
    expect(renderFinalVerdict(report)).toContain("Database access: missing");
    expect(renderFinalVerdict(report)).toContain("No live telemetry evidence available");
  });
});

describe("phase75 final verdict rendering", () => {
  test("prints machine-checkable verdict tied to check IDs", () => {
    const output = renderFinalVerdict(
      buildPhase75Report({
        generatedAt: "2026-04-24T00:00:00.000Z",
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        matrix: buildFixtureMatrix(),
        acceptedReviewIdentities: buildAcceptedReviewIdentities(),
        degradedIdentities: [{ deliveryId: "d1", eventType: "pull_request.review_requested" }],
        failOpenIdentities: [{ deliveryId: "d2", eventType: "pull_request.review_requested" }],
        verification: {
          overallPassed: true,
          matrix: buildFixtureMatrix(),
          acceptedReviewIdentities: buildAcceptedReviewIdentities(),
          degradedIdentities: [{ deliveryId: "d1", eventType: "pull_request.review_requested" }],
          failOpenIdentities: [{ deliveryId: "d2", eventType: "pull_request.review_requested" }],
          checks: [{ id: "OPS75-CACHE-01", title: "cache review", passed: true, details: "ok" }],
        },
      }),
    );

    expect(output).toContain("Final verdict: PASS [OPS75-CACHE-01]");
  });
});
