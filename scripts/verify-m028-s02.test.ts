/**
 * Test suite for scripts/verify-m028-s02.ts
 *
 * Covers:
 *   - Check ID contract (4 IDs, exact names)
 *   - Envelope shape (check_ids, overallPassed, checks)
 *   - COMMENT-MARKER check (pass / fail / status_code)
 *   - UPSERT-CONTRACT check (update path, create path, pass / fail)
 *   - DB-gated checks (skip when sql=undefined)
 *   - overallPassed semantics (skipped counts as pass, failing non-skipped = false)
 *   - All check IDs present regardless of DB availability
 */

import { describe, expect, test } from "bun:test";
import {
  M028_S02_CHECK_IDS,
  evaluateM028S02,
  type M028S02Check,
  type M028S02EvaluationReport,
} from "./verify-m028-s02.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a minimal sql stub that returns the given rows for all queries. */
function makeSqlStub(rows: unknown[]): unknown {
  return function sqlStub() {
    return Promise.resolve(rows);
  };
}

/** Build a sql stub that throws on every query. */
function makeThrowingSqlStub(message = "connection refused"): unknown {
  return function sqlStub() {
    return Promise.reject(new Error(message));
  };
}

/** Build a sql stub with different responses per call index. */
function makeSequentialSqlStub(responses: Array<unknown[] | Error>): unknown {
  let callIndex = 0;
  return function sqlStub() {
    const response = responses[callIndex % responses.length];
    callIndex++;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  };
}

// ── Group: Check ID contract ─────────────────────────────────────────────

describe("Check ID contract", () => {
  test("M028_S02_CHECK_IDS has exactly 4 entries", () => {
    expect(M028_S02_CHECK_IDS).toHaveLength(4);
  });

  test("contains M028-S02-COMMENT-MARKER", () => {
    expect(M028_S02_CHECK_IDS).toContain("M028-S02-COMMENT-MARKER");
  });

  test("contains M028-S02-UPSERT-CONTRACT", () => {
    expect(M028_S02_CHECK_IDS).toContain("M028-S02-UPSERT-CONTRACT");
  });

  test("contains M028-S02-COMMENT-ID-SCHEMA", () => {
    expect(M028_S02_CHECK_IDS).toContain("M028-S02-COMMENT-ID-SCHEMA");
  });

  test("contains M028-S02-PUBLISHED-LINKAGE", () => {
    expect(M028_S02_CHECK_IDS).toContain("M028-S02-PUBLISHED-LINKAGE");
  });
});

// ── Group: Envelope shape ─────────────────────────────────────────────────

describe("Envelope shape", () => {
  test("evaluateM028S02 result has check_ids, overallPassed, checks fields", async () => {
    const report = await evaluateM028S02(undefined);
    expect(report).toHaveProperty("check_ids");
    expect(report).toHaveProperty("overallPassed");
    expect(report).toHaveProperty("checks");
  });

  test("checks array has length 4", async () => {
    const report = await evaluateM028S02(undefined);
    expect(report.checks).toHaveLength(4);
  });

  test("check_ids matches M028_S02_CHECK_IDS", async () => {
    const report = await evaluateM028S02(undefined);
    expect(report.check_ids).toEqual([...M028_S02_CHECK_IDS]);
  });

  test("each check has id, passed, skipped, status_code, detail fields", async () => {
    const report = await evaluateM028S02(undefined);
    for (const check of report.checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("passed");
      expect(check).toHaveProperty("skipped");
      expect(check).toHaveProperty("status_code");
      expect(check).toHaveProperty("detail");
    }
  });
});

// ── Group: COMMENT-MARKER check ───────────────────────────────────────────

describe("COMMENT-MARKER check", () => {
  async function getMarkerCheck(report: M028S02EvaluationReport): Promise<M028S02Check> {
    const check = report.checks.find((c) => c.id === "M028-S02-COMMENT-MARKER");
    if (!check) throw new Error("COMMENT-MARKER check missing from report");
    return check;
  }

  test("passes when formatPageComment output starts with the marker", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getMarkerCheck(report);
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
  });

  test("reports status_code: marker_present on pass", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getMarkerCheck(report);
    expect(check.status_code).toBe("marker_present");
  });

  test("detail includes first 80 chars on pass", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getMarkerCheck(report);
    expect(check.detail).toContain("first_80_chars");
  });

  test("not skipped — always runs regardless of DB availability", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getMarkerCheck(report);
    expect(check.skipped).toBe(false);
  });
});

// ── Group: UPSERT-CONTRACT check ─────────────────────────────────────────

describe("UPSERT-CONTRACT check", () => {
  async function getUpsertCheck(report: M028S02EvaluationReport): Promise<M028S02Check> {
    const check = report.checks.find((c) => c.id === "M028-S02-UPSERT-CONTRACT");
    if (!check) throw new Error("UPSERT-CONTRACT check missing from report");
    return check;
  }

  test("passes when both update and create paths behave correctly", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getUpsertCheck(report);
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
  });

  test("reports status_code: upsert_contract_ok on pass", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getUpsertCheck(report);
    expect(check.status_code).toBe("upsert_contract_ok");
  });

  test("detail says update_path=ok and create_path=ok on pass", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getUpsertCheck(report);
    expect(check.detail).toContain("update_path=ok");
    expect(check.detail).toContain("create_path=ok");
  });

  test("not skipped — always runs regardless of DB availability", async () => {
    const report = await evaluateM028S02(undefined);
    const check = await getUpsertCheck(report);
    expect(check.skipped).toBe(false);
  });
});

// ── Group: DB-gated checks with no DB ────────────────────────────────────

describe("DB-gated checks — no DB available (sql=undefined)", () => {
  test("COMMENT-ID-SCHEMA skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM028S02(undefined);
    const check = report.checks.find((c) => c.id === "M028-S02-COMMENT-ID-SCHEMA");
    expect(check?.skipped).toBe(true);
    expect(check?.status_code).toBe("db_unavailable");
  });

  test("PUBLISHED-LINKAGE skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM028S02(undefined);
    const check = report.checks.find((c) => c.id === "M028-S02-PUBLISHED-LINKAGE");
    expect(check?.skipped).toBe(true);
    expect(check?.status_code).toBe("db_unavailable");
  });

  test("COMMENT-ID-SCHEMA skips with status_code: db_unavailable when sql throws", async () => {
    const sql = makeThrowingSqlStub("connection refused");
    const report = await evaluateM028S02(sql);
    const check = report.checks.find((c) => c.id === "M028-S02-COMMENT-ID-SCHEMA");
    expect(check?.skipped).toBe(true);
    expect(check?.status_code).toBe("db_unavailable");
  });

  test("PUBLISHED-LINKAGE skips with status_code: db_unavailable when sql throws", async () => {
    const sql = makeThrowingSqlStub("connection refused");
    const report = await evaluateM028S02(sql);
    const check = report.checks.find((c) => c.id === "M028-S02-PUBLISHED-LINKAGE");
    expect(check?.skipped).toBe(true);
    expect(check?.status_code).toBe("db_unavailable");
  });
});

// ── Group: DB-gated checks with DB present ──────────────────────────────

describe("DB-gated checks — DB available", () => {
  test("COMMENT-ID-SCHEMA passes with status_code: schema_ok when column present", async () => {
    // Return a row for the column query, and gap=0 for linkage query
    const sql = makeSequentialSqlStub([
      [{ column_name: "published_comment_id" }], // schema check
      [{ gap: 0 }],                               // linkage check
    ]);
    const report = await evaluateM028S02(sql);
    const check = report.checks.find((c) => c.id === "M028-S02-COMMENT-ID-SCHEMA");
    expect(check?.passed).toBe(true);
    expect(check?.skipped).toBe(false);
    expect(check?.status_code).toBe("schema_ok");
  });

  test("COMMENT-ID-SCHEMA fails with status_code: column_missing when no row returned", async () => {
    const sql = makeSequentialSqlStub([
      [],          // schema check: no rows
      [{ gap: 0 }],
    ]);
    const report = await evaluateM028S02(sql);
    const check = report.checks.find((c) => c.id === "M028-S02-COMMENT-ID-SCHEMA");
    expect(check?.passed).toBe(false);
    expect(check?.skipped).toBe(false);
    expect(check?.status_code).toBe("column_missing");
  });

  test("PUBLISHED-LINKAGE passes with status_code: no_linkage_gap when gap=0", async () => {
    const sql = makeSequentialSqlStub([
      [{ column_name: "published_comment_id" }],
      [{ gap: 0 }],
    ]);
    const report = await evaluateM028S02(sql);
    const check = report.checks.find((c) => c.id === "M028-S02-PUBLISHED-LINKAGE");
    expect(check?.passed).toBe(true);
    expect(check?.skipped).toBe(false);
    expect(check?.status_code).toBe("no_linkage_gap");
  });

  test("PUBLISHED-LINKAGE fails with status_code: linkage_gap_found when gap>0", async () => {
    const sql = makeSequentialSqlStub([
      [{ column_name: "published_comment_id" }],
      [{ gap: 3 }],
    ]);
    const report = await evaluateM028S02(sql);
    const check = report.checks.find((c) => c.id === "M028-S02-PUBLISHED-LINKAGE");
    expect(check?.passed).toBe(false);
    expect(check?.skipped).toBe(false);
    expect(check?.status_code).toBe("linkage_gap_found");
    expect(check?.detail).toContain("3 published rows missing published_comment_id");
  });
});

// ── Group: overallPassed semantics ────────────────────────────────────────

describe("overallPassed semantics", () => {
  test("overallPassed is true when all pure-code checks pass and DB checks are skipped", async () => {
    const report = await evaluateM028S02(undefined);
    // Pure-code checks always pass, DB checks skip → overall should pass
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is true when all checks pass including DB checks", async () => {
    const sql = makeSequentialSqlStub([
      [{ column_name: "published_comment_id" }],
      [{ gap: 0 }],
    ]);
    const report = await evaluateM028S02(sql);
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when COMMENT-ID-SCHEMA reports column_missing (DB reachable but column absent)", async () => {
    const sql = makeSequentialSqlStub([
      [],           // schema check: column missing
      [{ gap: 0 }],
    ]);
    const report = await evaluateM028S02(sql);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is false when PUBLISHED-LINKAGE reports linkage_gap_found", async () => {
    const sql = makeSequentialSqlStub([
      [{ column_name: "published_comment_id" }],
      [{ gap: 5 }],
    ]);
    const report = await evaluateM028S02(sql);
    expect(report.overallPassed).toBe(false);
  });

  test("skipped checks do not contribute to overall failure", async () => {
    // DB unavailable: DB checks skip but should not fail overall
    const report = await evaluateM028S02(undefined);
    const skippedChecks = report.checks.filter((c) => c.skipped);
    expect(skippedChecks.length).toBeGreaterThan(0);
    expect(report.overallPassed).toBe(true);
  });
});

// ── Group: All check IDs present regardless of DB ────────────────────────

describe("All check IDs present even when DB skipped", () => {
  test("result always has exactly 4 checks regardless of DB availability", async () => {
    const report = await evaluateM028S02(undefined);
    expect(report.checks).toHaveLength(4);
  });

  test("check IDs in result match M028_S02_CHECK_IDS (no DB)", async () => {
    const report = await evaluateM028S02(undefined);
    const ids = report.checks.map((c) => c.id);
    for (const expectedId of M028_S02_CHECK_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test("check IDs in result match M028_S02_CHECK_IDS (DB throwing)", async () => {
    const sql = makeThrowingSqlStub("no route to host");
    const report = await evaluateM028S02(sql);
    const ids = report.checks.map((c) => c.id);
    for (const expectedId of M028_S02_CHECK_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test("pure-code checks still pass even when DB throws", async () => {
    const sql = makeThrowingSqlStub("timeout");
    const report = await evaluateM028S02(sql);
    const markerCheck = report.checks.find((c) => c.id === "M028-S02-COMMENT-MARKER");
    const upsertCheck = report.checks.find((c) => c.id === "M028-S02-UPSERT-CONTRACT");
    expect(markerCheck?.passed).toBe(true);
    expect(upsertCheck?.passed).toBe(true);
  });
});
