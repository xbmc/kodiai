import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  LOCKED_CACHE_SEQUENCE,
  buildDeterministicScenario,
  evaluateVerification,
  renderOperatorSummary,
  validateSummaryLanguage,
  assertLockedOrdering,
} from "./phase72-telemetry-follow-through.ts";

function createTelemetryFixtureDb(): Database {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE executions (delivery_id TEXT, event_type TEXT NOT NULL, conclusion TEXT NOT NULL)",
  );
  db.run(
    "CREATE TABLE rate_limit_events (delivery_id TEXT, event_type TEXT NOT NULL, cache_hit_rate REAL NOT NULL)",
  );
  return db;
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

describe("phase72 SQL assertions", () => {
  test("passes when DB state proves exactly-once + cache sequence + non-blocking completion", () => {
    const db = createTelemetryFixtureDb();
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

    for (const step of scenario) {
      db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
        step.deliveryId,
        step.eventType,
        "success",
      );
    }

    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r1",
      "pull_request.review_requested",
      0,
    );
    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r2",
      "pull_request.review_requested",
      1,
    );
    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r3",
      "pull_request.review_requested",
      0,
    );

    const report = evaluateVerification(db, scenario);
    db.close();

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails when duplicate composite telemetry identities are present", () => {
    const db = createTelemetryFixtureDb();
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

    for (const step of scenario) {
      db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
        step.deliveryId,
        step.eventType,
        "success",
      );
    }

    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r1",
      "pull_request.review_requested",
      0,
    );
    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r2",
      "pull_request.review_requested",
      1,
    );
    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r3",
      "pull_request.review_requested",
      0,
    );
    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate) VALUES (?, ?, ?)").run(
      "r2",
      "pull_request.review_requested",
      1,
    );

    const report = evaluateVerification(db, scenario);
    db.close();

    expect(report.overallPassed).toBe(false);
    const duplicateCheck = report.checks.find((check) => check.id === "DB-C3");
    expect(duplicateCheck?.passed).toBe(false);
  });
});

describe("phase72 summary language guardrails", () => {
  test("renders evidence-cited verdict with risk framing in analysis", () => {
    const summary = renderOperatorSummary({
      overallPassed: true,
      scenario: [],
      checks: [
        { id: "DB-C1", title: "one", passed: true, details: "ok" },
        { id: "DB-C2", title: "two", passed: true, details: "ok" },
        { id: "DB-C3", title: "three", passed: true, details: "ok" },
        { id: "DB-C4", title: "four", passed: true, details: "ok" },
      ],
    });

    expect(summary).toContain("Risk note:");
    expect(summary).toContain("Final verdict: PASS");
    expect(summary).toContain("[DB-C1, DB-C2, DB-C3, DB-C4]");
    expect(validateSummaryLanguage(summary)).toEqual([]);
  });

  test("fails guardrail if demurral wording appears in verdict line", () => {
    const badSummary = [
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
      "Analysis: Evidence indicates stable behavior for this run.",
      "Risk note: residual risk remains.",
      "Final verdict: PASS - behavior is guaranteed stable.",
    ].join("\n");

    const errors = validateSummaryLanguage(badSummary);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("certainty language requires explicit evidence citations");
  });
});
