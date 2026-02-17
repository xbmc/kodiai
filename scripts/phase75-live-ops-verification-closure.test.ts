import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  LOCKED_CACHE_SEQUENCE,
  buildDeterministicMatrix,
  evaluateClosureVerification,
  parseIdentity,
  renderFinalVerdict,
  validateDeterministicMatrix,
  type Identity,
} from "./phase75-live-ops-verification-closure.ts";

function createFixtureDb(): Database {
  const db = new Database(":memory:");
  db.run("CREATE TABLE executions (delivery_id TEXT, event_type TEXT NOT NULL, conclusion TEXT NOT NULL)");
  db.run(
    "CREATE TABLE rate_limit_events (delivery_id TEXT, event_type TEXT NOT NULL, cache_hit_rate REAL NOT NULL, degradation_path TEXT NOT NULL DEFAULT 'none')",
  );
  return db;
}

function buildFixtureMatrix() {
  return buildDeterministicMatrix({
    review: {
      prime: "review-prime",
      hit: "review-hit",
      "changed-query-miss": "review-changed",
    },
    mention: {
      prime: "mention-prime",
      hit: "mention-hit",
      "changed-query-miss": "mention-changed",
    },
  });
}

function insertMatrixTelemetry(db: Database): void {
  db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
    "review-prime",
    "pull_request.review_requested",
    0,
    "none",
  );
  db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
    "review-hit",
    "pull_request.review_requested",
    1,
    "none",
  );
  db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
    "review-changed",
    "pull_request.review_requested",
    0,
    "degraded",
  );
  db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
    "mention-prime",
    "issue_comment.created",
    0,
    "none",
  );
  db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
    "mention-hit",
    "issue_comment.created",
    1,
    "none",
  );
  db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
    "mention-changed",
    "issue_comment.created",
    0,
    "degraded",
  );
}

describe("phase75 matrix helpers", () => {
  test("builds fixed review + mention prime->hit->changed ordering", () => {
    const matrix = buildFixtureMatrix();
    expect(LOCKED_CACHE_SEQUENCE).toEqual(["prime", "hit", "changed-query-miss"]);
    expect(() => validateDeterministicMatrix(matrix)).not.toThrow();
    expect(matrix.map((step) => `${step.surface}:${step.outcome}`)).toEqual([
      "review_requested:prime",
      "review_requested:hit",
      "review_requested:changed-query-miss",
      "kodiai_mention:prime",
      "kodiai_mention:hit",
      "kodiai_mention:changed-query-miss",
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
    { deliveryId: "mention-changed", eventType: "issue_comment.created" },
  ];
  const failOpenIdentities: Identity[] = [{ deliveryId: "failopen-review-1", eventType: "pull_request.review_requested" }];

  test("passes when cache matrix, degraded once-only, and fail-open completion all hold", () => {
    const db = createFixtureDb();
    const matrix = buildFixtureMatrix();

    insertMatrixTelemetry(db);

    for (const step of matrix) {
      db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
        step.deliveryId,
        step.eventType,
        "success",
      );
    }
    db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
      "failopen-review-1",
      "pull_request.review_requested",
      "success",
    );

    const report = evaluateClosureVerification(db, matrix, degradedIdentities, failOpenIdentities);
    db.close();

    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("fails duplicate degraded telemetry detection when same identity appears twice", () => {
    const db = createFixtureDb();
    const matrix = buildFixtureMatrix();
    insertMatrixTelemetry(db);

    db.query("INSERT INTO rate_limit_events (delivery_id, event_type, cache_hit_rate, degradation_path) VALUES (?, ?, ?, ?)").run(
      "review-changed",
      "pull_request.review_requested",
      0,
      "degraded",
    );

    for (const step of matrix) {
      db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
        step.deliveryId,
        step.eventType,
        "success",
      );
    }
    db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
      "failopen-review-1",
      "pull_request.review_requested",
      "success",
    );

    const report = evaluateClosureVerification(db, matrix, degradedIdentities, failOpenIdentities);
    db.close();

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "OPS75-ONCE-02")?.passed).toBe(false);
  });

  test("fails fail-open completion when forced-failure execution concludes with failure", () => {
    const db = createFixtureDb();
    const matrix = buildFixtureMatrix();
    insertMatrixTelemetry(db);

    for (const step of matrix) {
      db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
        step.deliveryId,
        step.eventType,
        "success",
      );
    }
    db.query("INSERT INTO executions (delivery_id, event_type, conclusion) VALUES (?, ?, ?)").run(
      "failopen-review-1",
      "pull_request.review_requested",
      "failed",
    );

    const report = evaluateClosureVerification(db, matrix, degradedIdentities, failOpenIdentities);
    db.close();

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "OPS75-FAILOPEN-02")?.passed).toBe(false);
  });
});

describe("phase75 final verdict rendering", () => {
  test("prints machine-checkable verdict tied to check IDs", () => {
    const output = renderFinalVerdict({
      overallPassed: true,
      matrix: buildFixtureMatrix(),
      degradedIdentities: [{ deliveryId: "d1", eventType: "pull_request.review_requested" }],
      failOpenIdentities: [{ deliveryId: "d2", eventType: "pull_request.review_requested" }],
      checks: [
        { id: "OPS75-CACHE-01", title: "cache review", passed: true, details: "ok" },
        { id: "OPS75-CACHE-02", title: "cache mention", passed: true, details: "ok" },
      ],
    });

    expect(output).toContain("Final verdict: PASS [OPS75-CACHE-01, OPS75-CACHE-02]");
  });
});
