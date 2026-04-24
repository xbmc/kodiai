import { describe, expect, test } from "bun:test";
import {
  LOCKED_CACHE_SEQUENCE,
  assertLockedOrdering,
  buildDeterministicScenario,
  buildPhase72Report,
  evaluatePhase72Verification,
  renderOperatorSummary,
  validateSummaryLanguage,
  type Phase72QueryResult,
} from "./phase72-telemetry-follow-through.ts";

function buildFixtureQueryResult(overrides: Partial<Phase72QueryResult> = {}): Phase72QueryResult {
  return {
    executions: [
      { deliveryId: "r1", eventType: "pull_request.review_requested", conclusion: "success" },
      { deliveryId: "r2", eventType: "pull_request.review_requested", conclusion: "success" },
      { deliveryId: "r3", eventType: "pull_request.review_requested", conclusion: "success" },
      { deliveryId: "m1", eventType: "issue_comment.created", conclusion: "success" },
      { deliveryId: "m2", eventType: "issue_comment.created", conclusion: "success" },
      { deliveryId: "m3", eventType: "issue_comment.created", conclusion: "success" },
    ],
    rateLimits: [
      { deliveryId: "r1", eventType: "pull_request.review_requested", cacheHitRate: 0 },
      { deliveryId: "r2", eventType: "pull_request.review_requested", cacheHitRate: 1 },
      { deliveryId: "r3", eventType: "pull_request.review_requested", cacheHitRate: 0 },
    ],
    duplicates: [],
    ...overrides,
  };
}

describe("phase72 deterministic scenario", () => {
  test("uses locked prime -> hit -> changed-query miss order for each surface", () => {
    const scenario = buildDeterministicScenario({
      review: {
        prime: "review-prime-1",
        hit: "review-hit-1",
        "changed-query-miss": "review-miss-1",
      },
      mention: {
        prime: "mention-prime-1",
        hit: "mention-hit-1",
        "changed-query-miss": "mention-miss-1",
      },
    });

    expect(LOCKED_CACHE_SEQUENCE).toEqual(["prime", "hit", "changed-query-miss"]);
    expect(() => assertLockedOrdering(scenario)).not.toThrow();
    expect(scenario.map((step) => `${step.surface}:${step.outcome}`)).toEqual([
      "review_requested:prime",
      "review_requested:hit",
      "review_requested:changed-query-miss",
      "kodiai_mention:prime",
      "kodiai_mention:hit",
      "kodiai_mention:changed-query-miss",
    ]);
  });
});

describe("phase72 verification", () => {
  test("passes when telemetry evidence proves exactly-once + cache sequence + non-blocking completion", () => {
    const scenario = buildDeterministicScenario({
      review: {
        prime: "r1",
        hit: "r2",
        "changed-query-miss": "r3",
      },
      mention: {
        prime: "m1",
        hit: "m2",
        "changed-query-miss": "m3",
      },
    });

    const report = evaluatePhase72Verification(buildFixtureQueryResult(), scenario);

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails when duplicate composite telemetry identities are present", () => {
    const scenario = buildDeterministicScenario({
      review: {
        prime: "r1",
        hit: "r2",
        "changed-query-miss": "r3",
      },
      mention: {
        prime: "m1",
        hit: "m2",
        "changed-query-miss": "m3",
      },
    });

    const report = evaluatePhase72Verification(
      buildFixtureQueryResult({
        duplicates: [{ deliveryId: "r2", eventType: "pull_request.review_requested", count: 2 }],
      }),
      scenario,
    );

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "DB-C3")?.passed).toBe(false);
  });

  test("builds fail-open preflight output when database access is unavailable", () => {
    const report = buildPhase72Report({
      generatedAt: "2026-04-24T00:00:00.000Z",
      accessState: "unavailable",
      accessDetail: "connect ECONNREFUSED",
      scenario: [],
      verification: null,
    });

    expect(report.preflight.databaseAccess).toBe("unavailable");
    expect(report.checks).toEqual([]);
    expect(renderOperatorSummary(report)).toContain("Database access: unavailable");
    expect(renderOperatorSummary(report)).toContain("No live telemetry evidence available");
  });
});

describe("phase72 summary language guardrails", () => {
  test("renders evidence-cited verdict with risk framing in analysis", () => {
    const summary = renderOperatorSummary(
      buildPhase72Report({
        generatedAt: "2026-04-24T00:00:00.000Z",
        accessState: "available",
        accessDetail: "Connected to telemetry Postgres.",
        scenario: [],
        verification: {
          overallPassed: true,
          checks: [
            { id: "DB-C1", title: "one", passed: true, details: "ok" },
            { id: "DB-C2", title: "two", passed: true, details: "ok" },
            { id: "DB-C3", title: "three", passed: true, details: "ok" },
            { id: "DB-C4", title: "four", passed: true, details: "ok" },
          ],
          scenario: [],
        },
      }),
    );

    expect(summary).toContain("Risk note:");
    expect(summary).toContain("Final verdict: PASS");
    expect(summary).toContain("[DB-C1, DB-C2, DB-C3, DB-C4]");
    expect(validateSummaryLanguage(summary)).toEqual([]);
  });

  test("fails guardrail if demurral wording appears in verdict line", () => {
    const badSummary = [
      "Database access: available",
      "Analysis: neutral.",
      "Risk note: residual risk remains.",
      "Final verdict: PASS - residual risk means this is uncertain.",
    ].join("\n");

    const errors = validateSummaryLanguage(badSummary);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("must not include demurral");
  });

  test("fails guardrail if verdict uses certainty language without DB citations", () => {
    const badSummary = [
      "Database access: available",
      "Analysis: Evidence indicates stable behavior for this run.",
      "Risk note: residual risk remains.",
      "Final verdict: PASS - behavior is guaranteed stable.",
    ].join("\n");

    const errors = validateSummaryLanguage(badSummary);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("certainty language requires explicit evidence citations");
  });
});
