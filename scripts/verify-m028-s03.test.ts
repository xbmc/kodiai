/**
 * Test suite for scripts/verify-m028-s03.ts
 *
 * Covers:
 *   - Check ID contract (4 IDs, exact names)
 *   - Envelope shape (check_ids, overallPassed, checks)
 *   - NO-WHY-IN-RENDER check (pass / fail paths)
 *   - LIVE-MARKER check (skip / pass / fail with DB stubs)
 *   - SENTINEL-CLEARED always-pass behavior (with and without DB)
 *   - overallPassed semantics (SENTINEL-CLEARED never causes failure)
 *   - COMMENT-BODY skip when GitHub args absent
 */

import { describe, expect, test } from "bun:test";
import {
  M028_S03_CHECK_IDS,
  evaluateM028S03,
  checkNoWhyInRender,
  checkLiveMarker,
  checkSentinelCleared,
  type M028S03Check,
  type M028S03EvaluationReport,
} from "./verify-m028-s03.ts";
import type { PageSuggestionGroup } from "../src/knowledge/wiki-publisher-types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a minimal sql stub that returns the given rows for all queries. */
function makeSqlStub(rows: unknown[]): unknown {
  return function sqlStub() {
    return Promise.resolve(rows);
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
  test("M028_S03_CHECK_IDS has exactly 4 entries", () => {
    expect(M028_S03_CHECK_IDS).toHaveLength(4);
  });

  test("contains M028-S03-NO-WHY-IN-RENDER", () => {
    expect(M028_S03_CHECK_IDS).toContain("M028-S03-NO-WHY-IN-RENDER");
  });

  test("contains M028-S03-LIVE-MARKER", () => {
    expect(M028_S03_CHECK_IDS).toContain("M028-S03-LIVE-MARKER");
  });

  test("contains M028-S03-COMMENT-BODY", () => {
    expect(M028_S03_CHECK_IDS).toContain("M028-S03-COMMENT-BODY");
  });

  test("contains M028-S03-SENTINEL-CLEARED", () => {
    expect(M028_S03_CHECK_IDS).toContain("M028-S03-SENTINEL-CLEARED");
  });
});

// ── Group: Envelope shape ─────────────────────────────────────────────────

describe("Envelope shape", () => {
  test("evaluateM028S03 result has check_ids, overallPassed, checks fields", async () => {
    const report = await evaluateM028S03();
    expect(report).toHaveProperty("check_ids");
    expect(report).toHaveProperty("overallPassed");
    expect(report).toHaveProperty("checks");
  });

  test("checks array has length 4", async () => {
    const report = await evaluateM028S03();
    expect(report.checks).toHaveLength(4);
  });

  test("check_ids matches M028_S03_CHECK_IDS", async () => {
    const report = await evaluateM028S03();
    expect(Array.from(report.check_ids)).toEqual([...M028_S03_CHECK_IDS]);
  });

  test("each check has id, passed, skipped, status_code fields", async () => {
    const report = await evaluateM028S03();
    for (const check of report.checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("passed");
      expect(check).toHaveProperty("skipped");
      expect(check).toHaveProperty("status_code");
    }
  });
});

// ── Group: NO-WHY-IN-RENDER check ────────────────────────────────────────

describe("NO-WHY-IN-RENDER check", () => {
  function getNoWhyCheck(report: M028S03EvaluationReport): M028S03Check {
    const check = report.checks.find((c) => c.id === "M028-S03-NO-WHY-IN-RENDER");
    if (!check) throw new Error("NO-WHY-IN-RENDER check missing from report");
    return check;
  }

  test("passes when formatPageComment renders without **Why:**", async () => {
    const report = await evaluateM028S03();
    const check = getNoWhyCheck(report);
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("no_why_in_render");
  });

  test("not skipped — always runs regardless of DB availability", async () => {
    const report = await evaluateM028S03(undefined);
    const check = getNoWhyCheck(report);
    expect(check.skipped).toBe(false);
  });

  test("passes when called directly with real formatPageComment", async () => {
    const result = await checkNoWhyInRender();
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("no_why_in_render");
  });

  test("fails with status_code: why_found when mock returns **Why:** in body", async () => {
    const mockFn = (_group: PageSuggestionGroup, _owner: string, _repo: string) =>
      "<!-- kodiai:wiki-modification:1 -->\n\n**Why:** some reason here\n\n## Content";
    const result = await checkNoWhyInRender(mockFn);
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("why_found");
    expect(result.detail).toContain("why_found");
  });

  test("fails with status_code: why_found when mock returns :warning: in body", async () => {
    const mockFn = (_group: PageSuggestionGroup, _owner: string, _repo: string) =>
      "<!-- kodiai:wiki-modification:1 -->\n\n:warning: voice mismatch\n\n## Content";
    const result = await checkNoWhyInRender(mockFn);
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("why_found");
  });
});

// ── Group: LIVE-MARKER check ──────────────────────────────────────────────

describe("LIVE-MARKER check", () => {
  function getLiveMarkerCheck(report: M028S03EvaluationReport): M028S03Check {
    const check = report.checks.find((c) => c.id === "M028-S03-LIVE-MARKER");
    if (!check) throw new Error("LIVE-MARKER check missing from report");
    return check;
  }

  test("skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM028S03(undefined);
    const check = getLiveMarkerCheck(report);
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });

  test("checkLiveMarker: skip when no sql", async () => {
    const result = await checkLiveMarker(undefined);
    expect(result.skipped).toBe(true);
    expect(result.status_code).toBe("db_unavailable");
  });

  test("passes with status_code: real_ids_found when count=3", async () => {
    const sql = makeSqlStub([{ cnt: 3 }]);
    const result = await checkLiveMarker(sql);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("real_ids_found");
    expect(result.detail).toContain("count=3");
  });

  test("fails with status_code: no_real_ids when count=0", async () => {
    const sql = makeSqlStub([{ cnt: 0 }]);
    const result = await checkLiveMarker(sql);
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("no_real_ids");
  });

  test("skips with status_code: db_unavailable when sql throws", async () => {
    const sql = () => Promise.reject(new Error("connection refused"));
    const result = await checkLiveMarker(sql);
    expect(result.skipped).toBe(true);
    expect(result.status_code).toBe("db_unavailable");
  });
});

// ── Group: SENTINEL-CLEARED check ────────────────────────────────────────

describe("SENTINEL-CLEARED check", () => {
  function getSentinelCheck(report: M028S03EvaluationReport): M028S03Check {
    const check = report.checks.find((c) => c.id === "M028-S03-SENTINEL-CLEARED");
    if (!check) throw new Error("SENTINEL-CLEARED check missing from report");
    return check;
  }

  test("always passes even when DB absent (sql=undefined)", async () => {
    const report = await evaluateM028S03(undefined);
    const check = getSentinelCheck(report);
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("db_unavailable");
  });

  test("checkSentinelCleared: passed=true when no sql", async () => {
    const result = await checkSentinelCleared(undefined);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
  });

  test("always passes and reports count when DB returns count=21", async () => {
    const sql = makeSqlStub([{ cnt: 21 }]);
    const result = await checkSentinelCleared(sql);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("sentinel_count");
    expect(result.detail).toContain("21");
  });

  test("always passes even when count=0 sentinel rows", async () => {
    const sql = makeSqlStub([{ cnt: 0 }]);
    const result = await checkSentinelCleared(sql);
    expect(result.passed).toBe(true);
    expect(result.status_code).toBe("sentinel_count");
    expect(result.detail).toContain("sentinel_rows=0");
  });

  test("always passes even when DB throws", async () => {
    const sql = () => Promise.reject(new Error("timeout"));
    const result = await checkSentinelCleared(sql);
    expect(result.passed).toBe(true);
  });
});

// ── Group: COMMENT-BODY check ─────────────────────────────────────────────

describe("COMMENT-BODY check", () => {
  function getCommentBodyCheck(report: M028S03EvaluationReport): M028S03Check {
    const check = report.checks.find((c) => c.id === "M028-S03-COMMENT-BODY");
    if (!check) throw new Error("COMMENT-BODY check missing from report");
    return check;
  }

  test("skips with status_code: github_unavailable when no octokit provided", async () => {
    const report = await evaluateM028S03(undefined, undefined, undefined, undefined, undefined);
    const check = getCommentBodyCheck(report);
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("github_unavailable");
  });
});

// ── Group: overallPassed semantics ────────────────────────────────────────

describe("overallPassed semantics", () => {
  test("overallPassed is true when pure-code checks pass and DB/GitHub checks are skipped", async () => {
    const report = await evaluateM028S03(undefined);
    // NO-WHY-IN-RENDER passes (pure-code), DB and GitHub checks skip → overall should pass
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when LIVE-MARKER fails (count=0), even if SENTINEL-CLEARED passes", async () => {
    // Sequential: LIVE-MARKER query returns count=0, SENTINEL-CLEARED returns count=21
    const sql = makeSequentialSqlStub([[{ cnt: 0 }], [{ cnt: 21 }]]);
    const report = await evaluateM028S03(sql);
    const liveMarker = report.checks.find((c) => c.id === "M028-S03-LIVE-MARKER");
    const sentinel = report.checks.find((c) => c.id === "M028-S03-SENTINEL-CLEARED");
    expect(liveMarker?.passed).toBe(false);
    expect(sentinel?.passed).toBe(true);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is true when NO-WHY-IN-RENDER and LIVE-MARKER pass, GitHub skipped", async () => {
    const sql = makeSequentialSqlStub([[{ cnt: 5 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S03(sql);
    const noWhy = report.checks.find((c) => c.id === "M028-S03-NO-WHY-IN-RENDER");
    const liveMarker = report.checks.find((c) => c.id === "M028-S03-LIVE-MARKER");
    const commentBody = report.checks.find((c) => c.id === "M028-S03-COMMENT-BODY");
    expect(noWhy?.passed).toBe(true);
    expect(liveMarker?.passed).toBe(true);
    expect(commentBody?.skipped).toBe(true);
    expect(report.overallPassed).toBe(true);
  });

  test("SENTINEL-CLEARED never contributes to overallPassed: false", async () => {
    // Even if sentinel count is high (e.g., 100 leftover rows), overall still passes
    const sql = makeSequentialSqlStub([[{ cnt: 5 }], [{ cnt: 100 }]]);
    const report = await evaluateM028S03(sql);
    const sentinel = report.checks.find((c) => c.id === "M028-S03-SENTINEL-CLEARED");
    expect(sentinel?.passed).toBe(true);
    // Overall should still pass because LIVE-MARKER passed (cnt=5) and COMMENT-BODY skipped
    expect(report.overallPassed).toBe(true);
  });

  test("skipped checks do not contribute to overall failure", async () => {
    const report = await evaluateM028S03(undefined);
    const skippedChecks = report.checks.filter((c) => c.skipped);
    expect(skippedChecks.length).toBeGreaterThan(0);
    expect(report.overallPassed).toBe(true);
  });
});

// ── Group: All check IDs present regardless of DB ────────────────────────

describe("All check IDs present regardless of DB/GitHub availability", () => {
  test("result always has exactly 4 checks regardless of DB/GitHub availability", async () => {
    const report = await evaluateM028S03(undefined);
    expect(report.checks).toHaveLength(4);
  });

  test("check IDs in result match M028_S03_CHECK_IDS", async () => {
    const report = await evaluateM028S03(undefined);
    const ids = report.checks.map((c) => c.id);
    for (const expectedId of M028_S03_CHECK_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test("NO-WHY-IN-RENDER still passes even when DB throws", async () => {
    const sql = () => Promise.reject(new Error("timeout"));
    const report = await evaluateM028S03(sql);
    const noWhy = report.checks.find((c) => c.id === "M028-S03-NO-WHY-IN-RENDER");
    expect(noWhy?.passed).toBe(true);
    expect(noWhy?.skipped).toBe(false);
  });
});
