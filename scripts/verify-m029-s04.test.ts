/**
 * Test suite for scripts/verify-m029-s04.ts
 *
 * Covers:
 *   - Check ID contract (5 IDs, exact names, correct order)
 *   - Envelope shape (check_ids, overallPassed, checks array with 5 entries)
 *   - CONTENT-FILTER-REJECTS: pass with real isReasoningProse; fail when mock forces false
 *   - PROMPT-BANS-META: pass with real buildVoicePreservingPrompt; fail when mock returns no contract
 *   - NO-REASONING-IN-DB: skip when sql=undefined; pass when count=0; fail when count=5; skip when sql throws
 *   - LIVE-PUBLISHED: skip when sql=undefined; pass when count=3; fail when count=0; skip when sql throws
 *   - ISSUE-CLEAN: skip when octokit=undefined; pass when all comments have marker or are summary table;
 *                  fail when one comment lacks marker and is not summary table
 *   - overallPassed semantics: all non-skipped pass → true; any fail → false; skipped don't gate
 *   - buildM029S04ProofHarness: exitCode 0 on all pass/skip; exitCode 1 on any fail; JSON + human output
 */

import { describe, expect, test } from "bun:test";
import {
  M029_S04_CHECK_IDS,
  evaluateM029S04,
  buildM029S04ProofHarness,
  type M029S04Check,
  type M029S04EvaluationReport,
} from "./verify-m029-s04.ts";
import type { PageStyleDescription, StyleExemplar } from "../src/knowledge/wiki-voice-types.ts";

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

/** Build a minimal octokit stub that returns paginated comment pages. */
function makeOctokitStub(pages: Array<Array<{ id: number; body: string }>>) {
  return {
    rest: {
      issues: {
        listComments: async ({
          page,
        }: {
          owner: string;
          repo: string;
          issue_number: number;
          per_page: number;
          page: number;
        }) => ({ data: pages[page - 1] ?? [] }),
      },
    },
  };
}

function getCheck(report: M029S04EvaluationReport, id: string): M029S04Check {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`Check ${id} missing from report`);
  return check;
}

// ── Group: Check ID contract ─────────────────────────────────────────────

describe("Check ID contract", () => {
  test("M029_S04_CHECK_IDS has exactly 5 entries", () => {
    expect(M029_S04_CHECK_IDS).toHaveLength(5);
  });

  test("contains M029-S04-CONTENT-FILTER-REJECTS", () => {
    expect(M029_S04_CHECK_IDS).toContain("M029-S04-CONTENT-FILTER-REJECTS");
  });

  test("contains M029-S04-PROMPT-BANS-META", () => {
    expect(M029_S04_CHECK_IDS).toContain("M029-S04-PROMPT-BANS-META");
  });

  test("contains M029-S04-NO-REASONING-IN-DB", () => {
    expect(M029_S04_CHECK_IDS).toContain("M029-S04-NO-REASONING-IN-DB");
  });

  test("contains M029-S04-LIVE-PUBLISHED", () => {
    expect(M029_S04_CHECK_IDS).toContain("M029-S04-LIVE-PUBLISHED");
  });

  test("contains M029-S04-ISSUE-CLEAN", () => {
    expect(M029_S04_CHECK_IDS).toContain("M029-S04-ISSUE-CLEAN");
  });

  test("check IDs are in the correct order", () => {
    expect(Array.from(M029_S04_CHECK_IDS)).toEqual([
      "M029-S04-CONTENT-FILTER-REJECTS",
      "M029-S04-PROMPT-BANS-META",
      "M029-S04-NO-REASONING-IN-DB",
      "M029-S04-LIVE-PUBLISHED",
      "M029-S04-ISSUE-CLEAN",
    ]);
  });
});

// ── Group: Envelope shape ─────────────────────────────────────────────────

describe("Envelope shape", () => {
  test("evaluateM029S04 result has check_ids, overallPassed, checks fields", async () => {
    const report = await evaluateM029S04();
    expect(report).toHaveProperty("check_ids");
    expect(report).toHaveProperty("overallPassed");
    expect(report).toHaveProperty("checks");
  });

  test("checks array has length 5", async () => {
    const report = await evaluateM029S04();
    expect(report.checks).toHaveLength(5);
  });

  test("check_ids matches M029_S04_CHECK_IDS", async () => {
    const report = await evaluateM029S04();
    expect(Array.from(report.check_ids)).toEqual([...M029_S04_CHECK_IDS]);
  });

  test("each check has id, passed, skipped, status_code fields", async () => {
    const report = await evaluateM029S04();
    for (const check of report.checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("passed");
      expect(check).toHaveProperty("skipped");
      expect(check).toHaveProperty("status_code");
    }
  });
});

// ── Group: CONTENT-FILTER-REJECTS check ─────────────────────────────────

describe("CONTENT-FILTER-REJECTS check", () => {
  test("passes with real isReasoningProse import", async () => {
    const report = await evaluateM029S04();
    const check = getCheck(report, "M029-S04-CONTENT-FILTER-REJECTS");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("content_filter_rejects");
  });

  test("not skipped — always runs regardless of DB/GitHub availability", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    const check = getCheck(report, "M029-S04-CONTENT-FILTER-REJECTS");
    expect(check.skipped).toBe(false);
  });

  test("fails when mock _contentFilterFn returns false", async () => {
    const mockFn = (_text: string) => false;
    const report = await evaluateM029S04({ _contentFilterFn: mockFn });
    const check = getCheck(report, "M029-S04-CONTENT-FILTER-REJECTS");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("content_filter_broken");
  });
});

// ── Group: PROMPT-BANS-META check ────────────────────────────────────────

describe("PROMPT-BANS-META check", () => {
  test("passes with real buildVoicePreservingPrompt", async () => {
    const report = await evaluateM029S04();
    const check = getCheck(report, "M029-S04-PROMPT-BANS-META");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("prompt_bans_meta");
  });

  test("not skipped regardless of DB/GitHub availability", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    const check = getCheck(report, "M029-S04-PROMPT-BANS-META");
    expect(check.skipped).toBe(false);
  });

  test("fails when mock _promptBuilderFn returns prompt without Output Contract", async () => {
    const mockFn = (_opts: {
      styleDescription: PageStyleDescription;
      exemplarSections: StyleExemplar[];
      originalSection: string;
      sectionHeading: string | null;
      diffEvidence: string;
    }) => "You are updating a wiki section.\nKeep the same voice.\n";
    const report = await evaluateM029S04({ _promptBuilderFn: mockFn });
    const check = getCheck(report, "M029-S04-PROMPT-BANS-META");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("prompt_missing_contract");
  });

  test("fails when mock _promptBuilderFn returns prompt with Output Contract but no Do NOT", async () => {
    const mockFn = () =>
      "You are updating a wiki section.\n## Output Contract\nOutput the updated section.\n";
    const report = await evaluateM029S04({ _promptBuilderFn: mockFn as Parameters<typeof evaluateM029S04>[0]["_promptBuilderFn"] });
    const check = getCheck(report, "M029-S04-PROMPT-BANS-META");
    expect(check.passed).toBe(false);
    expect(check.status_code).toBe("prompt_missing_contract");
  });
});

// ── Group: NO-REASONING-IN-DB check ──────────────────────────────────────

describe("NO-REASONING-IN-DB check", () => {
  test("skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM029S04({ sql: undefined });
    const check = getCheck(report, "M029-S04-NO-REASONING-IN-DB");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });

  test("passes with status_code: no_reasoning_in_db when count=0", async () => {
    // Sequential: NO-REASONING-IN-DB count=0, LIVE-PUBLISHED count=3
    const sql = makeSequentialSqlStub([[{ cnt: 0 }], [{ cnt: 3 }]]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-NO-REASONING-IN-DB");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("no_reasoning_in_db");
  });

  test("fails with status_code: reasoning_rows_found when count=5", async () => {
    // Sequential: NO-REASONING-IN-DB count=5, LIVE-PUBLISHED count=3
    const sql = makeSequentialSqlStub([[{ cnt: 5 }], [{ cnt: 3 }]]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-NO-REASONING-IN-DB");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("reasoning_rows_found");
    expect(check.detail).toContain("count=5");
  });

  test("skips with status_code: db_unavailable when sql throws", async () => {
    const sql = () => Promise.reject(new Error("connection refused"));
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-NO-REASONING-IN-DB");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });
});

// ── Group: LIVE-PUBLISHED check ───────────────────────────────────────────

describe("LIVE-PUBLISHED check", () => {
  test("skips with status_code: db_unavailable when sql is undefined", async () => {
    const report = await evaluateM029S04({ sql: undefined });
    const check = getCheck(report, "M029-S04-LIVE-PUBLISHED");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });

  test("passes with status_code: live_published when count=3", async () => {
    // Sequential: NO-REASONING-IN-DB count=0, LIVE-PUBLISHED count=3
    const sql = makeSequentialSqlStub([[{ cnt: 0 }], [{ cnt: 3 }]]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("live_published");
    expect(check.detail).toContain("count=3");
  });

  test("passes when count=1 (boundary — threshold is > 0)", async () => {
    const sql = makeSequentialSqlStub([[{ cnt: 0 }], [{ cnt: 1 }]]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("live_published");
  });

  test("fails with status_code: no_published_rows when count=0", async () => {
    // Both DB checks return 0
    const sql = makeSqlStub([{ cnt: 0 }]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("no_published_rows");
  });

  test("skips with status_code: db_unavailable when sql throws", async () => {
    const sql = () => Promise.reject(new Error("timeout"));
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-LIVE-PUBLISHED");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("db_unavailable");
  });
});

// ── Group: ISSUE-CLEAN check ──────────────────────────────────────────────

describe("ISSUE-CLEAN check", () => {
  test("skips with status_code: github_unavailable when octokit is undefined", async () => {
    const report = await evaluateM029S04({ octokit: undefined });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("github_unavailable");
  });

  test("passes when all comments have modification marker", async () => {
    const octokit = makeOctokitStub([
      [
        { id: 1, body: "<!-- kodiai:wiki-modification:1 -->\nSome content" },
        { id: 2, body: "<!-- kodiai:wiki-modification:2 -->\nMore content" },
      ],
    ]);
    const report = await evaluateM029S04({ octokit });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.passed).toBe(true);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("issue_clean");
  });

  test("passes when comment is summary table (contains # Wiki Modification Artifacts)", async () => {
    const octokit = makeOctokitStub([
      [
        { id: 1, body: "<!-- kodiai:wiki-modification:1 -->\nContent" },
        { id: 2, body: "# Wiki Modification Artifacts\n\n| Page | Status |\n" },
      ],
    ]);
    const report = await evaluateM029S04({ octokit });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("issue_clean");
  });

  test("fails when one comment lacks marker and is not summary table", async () => {
    const octokit = makeOctokitStub([
      [
        { id: 1, body: "<!-- kodiai:wiki-modification:1 -->\nContent" },
        { id: 2, body: "This is a plain comment without any marker." },
      ],
    ]);
    const report = await evaluateM029S04({ octokit });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.passed).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.status_code).toBe("unmarked_comments_found");
    expect(check.detail).toContain("violations=1");
  });

  test("handles pagination correctly — breaks when page returns fewer than 100", async () => {
    // Page 1: 100 marked comments, page 2: 1 clean comment, page 3: would break loop
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: `<!-- kodiai:wiki-modification:${i + 1} -->\nContent`,
    }));
    const page2 = [{ id: 101, body: "<!-- kodiai:wiki-modification:101 -->\nMore content" }];
    const octokit = makeOctokitStub([page1, page2]);
    const report = await evaluateM029S04({ octokit });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.passed).toBe(true);
    expect(check.status_code).toBe("issue_clean");
  });

  test("skips when octokit throws", async () => {
    const octokit = {
      rest: {
        issues: {
          listComments: async () => { throw new Error("GitHub API error"); },
        },
      },
    };
    const report = await evaluateM029S04({ octokit });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.skipped).toBe(true);
    expect(check.status_code).toBe("github_unavailable");
  });
});

// ── Group: overallPassed semantics ────────────────────────────────────────

describe("overallPassed semantics", () => {
  test("overallPassed is true when pure-code checks pass and DB/GitHub checks are skipped", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    expect(report.overallPassed).toBe(true);
  });

  test("overallPassed is false when NO-REASONING-IN-DB fails (count=5)", async () => {
    // NO-REASONING-IN-DB count=5 (fail), LIVE-PUBLISHED count=3 (pass)
    const sql = makeSequentialSqlStub([[{ cnt: 5 }], [{ cnt: 3 }]]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-NO-REASONING-IN-DB");
    expect(check.passed).toBe(false);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is false when LIVE-PUBLISHED fails (count=0)", async () => {
    const sql = makeSqlStub([{ cnt: 0 }]);
    const report = await evaluateM029S04({ sql });
    const check = getCheck(report, "M029-S04-LIVE-PUBLISHED");
    expect(check.passed).toBe(false);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is false when CONTENT-FILTER-REJECTS fails", async () => {
    const report = await evaluateM029S04({ _contentFilterFn: () => false });
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is false when PROMPT-BANS-META fails", async () => {
    const report = await evaluateM029S04({ _promptBuilderFn: () => "No contract here." });
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is false when ISSUE-CLEAN fails", async () => {
    const octokit = makeOctokitStub([
      [{ id: 1, body: "Plain comment without marker." }],
    ]);
    const report = await evaluateM029S04({ octokit });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.passed).toBe(false);
    expect(report.overallPassed).toBe(false);
  });

  test("overallPassed is true when all 5 checks pass", async () => {
    const sql = makeSequentialSqlStub([[{ cnt: 0 }], [{ cnt: 3 }]]);
    const octokit = makeOctokitStub([
      [{ id: 1, body: "<!-- kodiai:wiki-modification:1 -->\nContent" }],
    ]);
    const report = await evaluateM029S04({ sql, octokit });
    for (const check of report.checks) {
      if (!check.skipped) {
        expect(check.passed).toBe(true);
      }
    }
    expect(report.overallPassed).toBe(true);
  });

  test("skipped checks do not contribute to failure", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    const skipped = report.checks.filter((c) => c.skipped);
    // DB and GitHub checks skip when no sql/octokit — should not cause overall failure
    expect(skipped.length).toBeGreaterThan(0);
    expect(report.overallPassed).toBe(true);
  });
});

// ── Group: buildM029S04ProofHarness ──────────────────────────────────────

describe("buildM029S04ProofHarness", () => {
  test("returns exitCode: 0 when pure-code checks pass and DB/GitHub checks skip", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    // Force DB to skip by rejecting
    const sql = () => Promise.reject(new Error("test: no db"));
    const result = await buildM029S04ProofHarness({ sql, stdout, stderr, json: false });
    expect(result.exitCode).toBe(0);
  });

  test("returns exitCode: 1 when CONTENT-FILTER-REJECTS fails", async () => {
    const chunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };
    const result = await buildM029S04ProofHarness({
      sql: () => Promise.reject(new Error("no db")),
      _contentFilterFn: () => false,
      stdout,
      stderr,
      json: false,
    });
    expect(result.exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m029:s04 failed");
  });

  test("emits JSON output when json: true", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    await buildM029S04ProofHarness({ sql: undefined, octokit: undefined, stdout, stderr, json: true });
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
    await buildM029S04ProofHarness({ sql: undefined, octokit: undefined, stdout, stderr, json: false });
    const output = chunks.join("");
    expect(output).toContain("M029 / S04 proof harness");
    expect(output).toContain("Final verdict:");
  });

  test("returns exitCode: 1 when LIVE-PUBLISHED fails and emits stderr", async () => {
    const stderrChunks: string[] = [];
    const stdout = { write: (_s: string) => {} };
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };
    // NO-REASONING-IN-DB: count=0 (pass), LIVE-PUBLISHED: count=0 (fail)
    const sql = makeSqlStub([{ cnt: 0 }]);
    const result = await buildM029S04ProofHarness({ sql, stdout, stderr, json: false });
    expect(result.exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("no_published_rows");
  });
});

// ── Group: All check IDs present regardless of availability ───────────────

describe("All check IDs present regardless of DB/GitHub availability", () => {
  test("result always has exactly 5 checks regardless of DB/GitHub availability", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    expect(report.checks).toHaveLength(5);
  });

  test("check IDs in result match M029_S04_CHECK_IDS", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    const ids = report.checks.map((c) => c.id);
    for (const expectedId of M029_S04_CHECK_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  test("pure-code checks (CONTENT-FILTER-REJECTS, PROMPT-BANS-META) never skip", async () => {
    const report = await evaluateM029S04({ sql: undefined, octokit: undefined });
    for (const id of [
      "M029-S04-CONTENT-FILTER-REJECTS",
      "M029-S04-PROMPT-BANS-META",
    ]) {
      const check = getCheck(report, id);
      expect(check.skipped).toBe(false);
    }
  });

  test("DB-gated checks (NO-REASONING-IN-DB, LIVE-PUBLISHED) skip when no sql", async () => {
    const report = await evaluateM029S04({ sql: undefined });
    for (const id of ["M029-S04-NO-REASONING-IN-DB", "M029-S04-LIVE-PUBLISHED"]) {
      const check = getCheck(report, id);
      expect(check.skipped).toBe(true);
    }
  });

  test("ISSUE-CLEAN skips when no octokit", async () => {
    const report = await evaluateM029S04({ octokit: undefined });
    const check = getCheck(report, "M029-S04-ISSUE-CLEAN");
    expect(check.skipped).toBe(true);
  });
});
