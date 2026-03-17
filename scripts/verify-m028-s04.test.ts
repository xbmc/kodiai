/**
 * Test suite for scripts/verify-m028-s04.ts
 *
 * Covers:
 *   - Check ID contract (5 IDs, exact names, correct order)
 *   - Envelope shape (check_ids, overallPassed, checks array with 5 entries)
 *   - NO-WHY-IN-RENDER: pass with real formatPageComment; fail when mock returns **Why:**
 *   - NO-WHY-IN-SUMMARY: pass with fixed formatSummaryTable; fail when mock returns Wiki Update Suggestions
 *   - DRY-RUN-CLEAN: pass with real formatPageComment; fail when mock returns :warning:
 *   - LIVE-PUBLISHED: skip when no sql; pass when count=85; fail when count=2
 *   - SENTINEL-SUPERSEDED: skip when no sql; pass when count=0; fail when count=21
 *   - overallPassed semantics: SENTINEL-SUPERSEDED is a real gate (not informational)
 *   - buildM028S04ProofHarness: exits 0 on all pass, 1 on any fail
 */

import { describe, expect, test } from "bun:test";
import {
  M028_S04_CHECK_IDS,
  evaluateM028S04,
  buildM028S04ProofHarness,
  type M028S04Check,
  type M028S04EvaluationReport,
} from "./verify-m028-s04.ts";
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

function getCheck(report: M028S04EvaluationReport, id: string): M028S04Check {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`Check ${id} missing from report`);
  return check;
}

// ── Group: Check ID contract ─────────────────────────────────────────────

describe("Check ID contract", () => {
  test("M028_S04_CHECK_IDS has exactly 5 entries", () => {
    expect(M028_S04_CHECK_IDS).toHaveLength(5);
  });

  test("contains M028-S04-NO-WHY-IN-RENDER", () => {
    expect(M028_S04_CHECK_IDS).toContain("M028-S04-NO-WHY-IN-RENDER");
  });

  test("contains M028-S04-NO-WHY-IN-SUMMARY", () => {
    expect(M028_S04_CHECK_IDS).toContain("M028-S04-NO-WHY-IN-SUMMARY");
  });

  test("contains M028-S04-LIVE-PUBLISHED", () => {
    expect(M028_S04_CHECK_IDS).toContain("M028-S04-LIVE-PUBLISHED");
  });

  test("contains M028-S04-SENTINEL-SUPERSEDED", () => {
    expect(M028_S04_CHECK_IDS).toContain("M028-S04-SENTINEL-SUPERSEDED");
  });

  test("contains M028-S04-DRY-RUN-CLEAN", () => {
    expect(M028_S04_CHECK_IDS).toContain("M028-S04-DRY-RUN-CLEAN");
  });

  test("check IDs are in the correct order", () => {
    expect(Array.from(M028_S04_CHECK_IDS)).toEqual([
      "M028-S04-NO-WHY-IN-RENDER",
      "M028-S04-NO-WHY-IN-SUMMARY",
      "M028-S04-LIVE-PUBLISHED",
      "M028-S04-SENTINEL-SUPERSEDED",
      "M028-S04-DRY-RUN-CLEAN",
    ]);
  });
});

// ── Group: Envelope shape ─────────────────────────────────────────────────

describe("Envelope shape", () => {
  test("evaluateM028S04 result has check_ids, overallPassed, checks fields", async () => {
    const report = await evaluateM028S04();
    expect(report).toHaveProperty("check_ids");
    expect(report).toHaveProperty("overallPassed");
    expect(report).toHaveProperty("checks");
  });

  test("checks array has length 5", async () => {
    const report = await evaluateM028S04();
    expect(report.checks).toHaveLength(5);
  });

  test("check_ids matches M028_S04_CHECK_IDS", async () => {
    const report = await evaluateM028S04();
    expect(Array.from(report.check_ids)).toEqual([...M028_S04_CHECK_IDS]);
  });

  test("each check has id, passed, skipped, status_code fields", async () => {
    const report = await evaluateM028S04();
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
  test("passes with real formatPageComment", async () => {
    const report = await evaluateM028S04();
    const check = getCheck(report, "M028-S04-NO-WHY-IN-RENDER");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("no_why_in_render");
  });

  test("not skipped — always runs regardless of DB availability", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-RENDER");
    expect(check.skipped).toBe(false);
  });

  test("fails when mock _formatFn returns **Why:** in body", async () => {
    const mockFn = (_g: PageSuggestionGroup, _o: string, _r: string) =>
      "<!-- kodiai:wiki-modification:1 -->\n**Why:** some reason\n## Content";
    const report = await evaluateM028S04({ _formatFn: mockFn });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-RENDER");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("why_found");
  });

  test("fails when mock _formatFn returns :warning: in body", async () => {
    const mockFn = (_g: PageSuggestionGroup, _o: string, _r: string) =>
      "<!-- kodiai:wiki-modification:1 -->\n:warning: voice mismatch\n## Content";
    const report = await evaluateM028S04({ _formatFn: mockFn });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-RENDER");
    expect(check.passed).toBe(false);
    expect(check.status_code).toBe("why_found");
  });
});

// ── Group: NO-WHY-IN-SUMMARY check ──────────────────────────────────────

describe("NO-WHY-IN-SUMMARY check", () => {
  test("passes with fixed formatSummaryTable (post-T01)", async () => {
    const report = await evaluateM028S04();
    const check = getCheck(report, "M028-S04-NO-WHY-IN-SUMMARY");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("no_why_in_summary");
  });

  test("not skipped regardless of DB availability", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-SUMMARY");
    expect(check.skipped).toBe(false);
  });

  test("fails when _summaryFn returns 'Wiki Update Suggestions'", async () => {
    const mockFn = () => "# Wiki Update Suggestions — 2026-01-01\n**Suggestions posted:** 0";
    const report = await evaluateM028S04({ _summaryFn: mockFn });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-SUMMARY");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("why_found_in_summary");
  });

  test("fails when _summaryFn returns '**Why:**'", async () => {
    const mockFn = () => "# Table\n\n**Why:** some summary reason\n";
    const report = await evaluateM028S04({ _summaryFn: mockFn });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-SUMMARY");
    expect(check.passed).toBe(false);
    expect(check.status_code).toBe("why_found_in_summary");
  });

  test("fails when _summaryFn returns ':warning:'", async () => {
    const mockFn = () => "# Table\n\n:warning: voice warning\n";
    const report = await evaluateM028S04({ _summaryFn: mockFn });
    const check = getCheck(report, "M028-S04-NO-WHY-IN-SUMMARY");
    expect(check.passed).toBe(false);
    expect(check.status_code).toBe("why_found_in_summary");
  });
});

// ── Group: DRY-RUN-CLEAN check ───────────────────────────────────────────

describe("DRY-RUN-CLEAN check", () => {
  test("passes with real formatPageComment", async () => {
    const report = await evaluateM028S04();
    const check = getCheck(report, "M028-S04-DRY-RUN-CLEAN");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("dry_run_clean");
  });

  test("not skipped regardless of DB availability", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const check = getCheck(report, "M028-S04-DRY-RUN-CLEAN");
    expect(check.skipped).toBe(false);
  });

  test("fails when _formatFn returns ':warning: voice' in body", async () => {
    const mockFn = (_g: PageSuggestionGroup, _o: string, _r: string) =>
      "<!-- kodiai:wiki-modification:42 -->\n:warning: voice\n## Installation";
    const report = await evaluateM028S04({ _formatFn: mockFn });
    const check = getCheck(report, "M028-S04-DRY-RUN-CLEAN");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("why_found_in_dry_run");
  });

  test("fails when _formatFn returns '**Why:**' in body", async () => {
    const mockFn = (_g: PageSuggestionGroup, _o: string, _r: string) =>
      "<!-- kodiai:wiki-modification:42 -->\n**Why:** docs changed\n## Installation";
    const report = await evaluateM028S04({ _formatFn: mockFn });
    const check = getCheck(report, "M028-S04-DRY-RUN-CLEAN");
    expect(check.passed).toBe(false);
    expect(check.status_code).toBe("why_found_in_dry_run");
  });
});

// ── Group: LIVE-PUBLISHED check ───────────────────────────────────────────

describe("LIVE-PUBLISHED check", () => {
  test("skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const check = getCheck(report, "M028-S04-LIVE-PUBLISHED");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });

  test("passes with status_code: live_published when count=85", async () => {
    // Sequential: LIVE-PUBLISHED sees count=85, SENTINEL-SUPERSEDED sees count=0
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("live_published");
    expect(check.detail).toContain("count=85");
  });

  test("passes when count equals exactly 80 (boundary)", async () => {
    const sql = makeSequentialSqlStub([[{ cnt: 80 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("live_published");
  });

  test("fails with status_code: insufficient_published when count=2", async () => {
    const sql = makeSequentialSqlStub([[{ cnt: 2 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("insufficient_published");
    expect(check.detail).toContain("count=2");
  });

  test("skips with status_code: db_unavailable when sql throws", async () => {
    const sql = () => Promise.reject(new Error("connection refused"));
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-LIVE-PUBLISHED");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });
});

// ── Group: SENTINEL-SUPERSEDED check ─────────────────────────────────────

describe("SENTINEL-SUPERSEDED check", () => {
  test("skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const check = getCheck(report, "M028-S04-SENTINEL-SUPERSEDED");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });

  test("passes when count=0 (all sentinel rows superseded)", async () => {
    // Sequential: LIVE-PUBLISHED gets count=85, SENTINEL-SUPERSEDED gets count=0
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-SENTINEL-SUPERSEDED");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("sentinel_superseded");
    expect(check.detail).toContain("sentinel_rows=0");
  });

  test("fails when count=21 (sentinel rows remain)", async () => {
    // Sequential: LIVE-PUBLISHED gets count=85, SENTINEL-SUPERSEDED gets count=21
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 21 }]]);
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-SENTINEL-SUPERSEDED");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("sentinel_rows_remain");
    expect(check.detail).toContain("21");
  });

  test("skips with status_code: db_unavailable when sql throws", async () => {
    const sql = () => Promise.reject(new Error("timeout"));
    const report = await evaluateM028S04({ sql });
    const check = getCheck(report, "M028-S04-SENTINEL-SUPERSEDED");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });
});

// ── Group: overallPassed semantics ────────────────────────────────────────

describe("overallPassed semantics", () => {
  test("overallPassed is true when all pure-code checks pass and DB checks are skipped", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    // All 3 pure-code checks pass; 2 DB checks skip → overall passes
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when SENTINEL-SUPERSEDED fails (count=21)", async () => {
    // LIVE-PUBLISHED: count=85 (pass), SENTINEL-SUPERSEDED: count=21 (fail)
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 21 }]]);
    const report = await evaluateM028S04({ sql });
    const sentinel = getCheck(report, "M028-S04-SENTINEL-SUPERSEDED");
    expect(sentinel.passed).toBe(false);
    expect(report.overallPassed).toBe(false);
  });

  test("SENTINEL-SUPERSEDED is NOT excluded from overallPassed gate (unlike S03 SENTINEL-CLEARED)", async () => {
    // Regression guard: sentinel rows remaining MUST cause overallPassed=false
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 1 }]]);
    const report = await evaluateM028S04({ sql });
    const sentinel = getCheck(report, "M028-S04-SENTINEL-SUPERSEDED");
    expect(sentinel.passed).toBe(false);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is true when all 5 checks pass (DB stubs both passing)", async () => {
    // LIVE-PUBLISHED count=85 (pass), SENTINEL-SUPERSEDED count=0 (pass)
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S04({ sql });
    for (const check of report.checks) {
      if (!check.skipped) {
        expect(check.passed).toBe(true);
      }
    }
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when LIVE-PUBLISHED fails (count=2)", async () => {
    const sql = makeSequentialSqlStub([[{ cnt: 2 }], [{ cnt: 0 }]]);
    const report = await evaluateM028S04({ sql });
    const livePublished = getCheck(report, "M028-S04-LIVE-PUBLISHED");
    expect(livePublished.passed).toBe(false);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is false when NO-WHY-IN-RENDER fails", async () => {
    const mockFn = (_g: PageSuggestionGroup, _o: string, _r: string) =>
      "**Why:** reason here\n## Content";
    const report = await evaluateM028S04({ _formatFn: mockFn });
    expect(report.overallPassed).toBe(false);
  });

  test("skipped checks do not contribute to failure", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const skipped = report.checks.filter((c) => c.skipped);
    // DB checks skip when no sql — should not cause overall failure
    expect(skipped.length).toBeGreaterThan(0);
    expect(report.overallPassed).toBe(true);
  });
});

// ── Group: buildM028S04ProofHarness ──────────────────────────────────────

describe("buildM028S04ProofHarness", () => {
  test("returns exitCode: 0 when all non-skipped checks pass (no DB = DB checks skipped)", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    // Use a rejecting sql stub to ensure DB checks skip (not auto-probe from env)
    const sql = () => Promise.reject(new Error("test: no db"));
    const result = await buildM028S04ProofHarness({
      sql,
      stdout,
      stderr,
      json: false,
    });
    expect(result.exitCode).toBe(0);
  });

  test("returns exitCode: 1 when SENTINEL-SUPERSEDED fails", async () => {
    const chunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };
    // LIVE-PUBLISHED pass (85), SENTINEL-SUPERSEDED fail (21)
    const sql = makeSequentialSqlStub([[{ cnt: 85 }], [{ cnt: 21 }]]);
    const result = await buildM028S04ProofHarness({ sql, stdout, stderr, json: false });
    expect(result.exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m028:s04 failed");
  });

  test("emits JSON output when json: true", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    await buildM028S04ProofHarness({ sql: undefined, stdout, stderr, json: true });
    const output = chunks.join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("overallPassed");
    expect(parsed).toHaveProperty("checks");
    expect(parsed.checks).toHaveLength(5);
  });

  test("emits human-readable output when json: false", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    await buildM028S04ProofHarness({ sql: undefined, stdout, stderr, json: false });
    const output = chunks.join("");
    expect(output).toContain("M028 / S04 proof harness");
    expect(output).toContain("Final verdict:");
  });
});

// ── Group: All check IDs present regardless of DB availability ────────────

describe("All check IDs present regardless of DB availability", () => {
  test("result always has exactly 5 checks regardless of DB availability", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    expect(report.checks).toHaveLength(5);
  });

  test("check IDs in result match M028_S04_CHECK_IDS", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    const ids = report.checks.map((c) => c.id);
    for (const expectedId of M028_S04_CHECK_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test("pure-code checks (NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN) never skip", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    for (const id of [
      "M028-S04-NO-WHY-IN-RENDER",
      "M028-S04-NO-WHY-IN-SUMMARY",
      "M028-S04-DRY-RUN-CLEAN",
    ]) {
      const check = getCheck(report, id);
      expect(check.skipped).toBe(false);
    }
  });

  test("DB-gated checks (LIVE-PUBLISHED, SENTINEL-SUPERSEDED) skip when no sql", async () => {
    const report = await evaluateM028S04({ sql: undefined });
    for (const id of ["M028-S04-LIVE-PUBLISHED", "M028-S04-SENTINEL-SUPERSEDED"]) {
      const check = getCheck(report, id);
      expect(check.skipped).toBe(true);
    }
  });
});
