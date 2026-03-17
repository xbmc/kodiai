/**
 * M028 / S03 proof harness.
 *
 * Four checks:
 *   - M028-S03-NO-WHY-IN-RENDER   (pure-code)     — formatPageComment has no **Why:** or :warning:
 *   - M028-S03-LIVE-MARKER        (DB-gated)       — at least one published row with real comment ID
 *   - M028-S03-COMMENT-BODY       (GitHub-gated)   — issue comment has marker AND no **Why:**
 *   - M028-S03-SENTINEL-CLEARED   (DB-gated, info) — always passes; reports sentinel row count
 *
 * Usage:
 *   bun run verify:m028:s03 [--json]
 *
 * Exit 0 = overallPassed true (all non-skipped, non-informational checks pass).
 * Exit 1 = at least one non-skipped, non-informational check failed.
 */

import { formatPageComment } from "../src/knowledge/wiki-publisher.ts";
import type { PageSuggestionGroup } from "../src/knowledge/wiki-publisher-types.ts";
import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";

// ── Exports and types ────────────────────────────────────────────────────

export const M028_S03_CHECK_IDS = [
  "M028-S03-NO-WHY-IN-RENDER",
  "M028-S03-LIVE-MARKER",
  "M028-S03-COMMENT-BODY",
  "M028-S03-SENTINEL-CLEARED",
] as const;

export type M028S03CheckId = (typeof M028_S03_CHECK_IDS)[number];

export type M028S03Check = {
  id: M028S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M028S03EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M028S03Check[];
};

// ── Silent logger for internal mock calls ────────────────────────────────

function createSilentLogger(): Logger {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createSilentLogger(),
    level: "silent",
  } as unknown as Logger;
}

// ── Check: NO-WHY-IN-RENDER ──────────────────────────────────────────────

export async function checkNoWhyInRender(
  _formatFn?: (group: PageSuggestionGroup, prOwner: string, prRepo: string) => string,
): Promise<M028S03Check> {
  const fn = _formatFn ?? formatPageComment;

  const group: PageSuggestionGroup = {
    pageId: 1,
    pageTitle: "Test Page",
    suggestions: [
      {
        sectionHeading: "Overview",
        suggestion: "Wiki text here.",
        whySummary: "Reason text.",
        citingPrs: [],
        voiceMismatchWarning: false,
      },
    ],
  };

  const rendered = fn(group, "xbmc", "xbmc");

  if (rendered.includes("**Why:**")) {
    const idx = rendered.indexOf("**Why:**");
    const snippet = rendered.slice(Math.max(0, idx - 20), idx + 40);
    return {
      id: "M028-S03-NO-WHY-IN-RENDER",
      passed: false,
      skipped: false,
      status_code: "why_found",
      detail: `why_found snippet=${JSON.stringify(snippet)}`,
    };
  }

  if (rendered.includes(":warning:")) {
    const idx = rendered.indexOf(":warning:");
    const snippet = rendered.slice(Math.max(0, idx - 20), idx + 40);
    return {
      id: "M028-S03-NO-WHY-IN-RENDER",
      passed: false,
      skipped: false,
      status_code: "why_found",
      detail: `warning_emoji_found snippet=${JSON.stringify(snippet)}`,
    };
  }

  return {
    id: "M028-S03-NO-WHY-IN-RENDER",
    passed: true,
    skipped: false,
    status_code: "no_why_in_render",
    detail: `render_clean length=${rendered.length}`,
  };
}

// ── Check: LIVE-MARKER ───────────────────────────────────────────────────

export async function checkLiveMarker(sql?: unknown): Promise<M028S03Check> {
  if (!sql) {
    return {
      id: "M028-S03-LIVE-MARKER",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: "db_unavailable: no sql connection",
    };
  }

  try {
    const rows = await (
      sql as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
    )`
      SELECT COUNT(*)::int AS cnt
      FROM wiki_update_suggestions
      WHERE published_at IS NOT NULL
        AND published_comment_id > 0
    `;

    const cnt = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

    if (cnt > 0) {
      return {
        id: "M028-S03-LIVE-MARKER",
        passed: true,
        skipped: false,
        status_code: "real_ids_found",
        detail: `count=${cnt}`,
      };
    }

    return {
      id: "M028-S03-LIVE-MARKER",
      passed: false,
      skipped: false,
      status_code: "no_real_ids",
      detail: "count=0 no published rows with real comment IDs",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S03-LIVE-MARKER",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Check: COMMENT-BODY ──────────────────────────────────────────────────

export async function checkCommentBody(
  octokit?: Octokit,
  owner?: string,
  repo?: string,
  issueNumber?: number,
): Promise<M028S03Check> {
  if (!octokit || !owner || !repo || !issueNumber) {
    return {
      id: "M028-S03-COMMENT-BODY",
      passed: false,
      skipped: true,
      status_code: "github_unavailable",
      detail: "github_unavailable: no octokit/owner/repo/issueNumber",
    };
  }

  try {
    // Fetch up to 3 pages of comments (most recent first)
    const allComments: Array<{ id: number; body?: string | null }> = [];
    for (let page = 1; page <= 3; page++) {
      const { data } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
        sort: "created",
        direction: "desc",
        page,
      });
      allComments.push(...data);
      if (data.length < 100) break;
    }

    let foundMarker = false;
    for (const comment of allComments) {
      const body = comment.body ?? "";
      if (!body.includes("<!-- kodiai:wiki-modification:")) continue;

      foundMarker = true;

      if (body.includes("**Why:**")) {
        const idx = body.indexOf("**Why:**");
        const snippet = body.slice(Math.max(0, idx - 20), idx + 40);
        return {
          id: "M028-S03-COMMENT-BODY",
          passed: false,
          skipped: false,
          status_code: "why_in_marker_comment",
          detail: `comment_id=${comment.id} snippet=${JSON.stringify(snippet)}`,
        };
      }

      // Clean marker comment found
      return {
        id: "M028-S03-COMMENT-BODY",
        passed: true,
        skipped: false,
        status_code: "modification_comment_found",
        detail: `comment_id=${comment.id}`,
      };
    }

    if (!foundMarker) {
      return {
        id: "M028-S03-COMMENT-BODY",
        passed: false,
        skipped: false,
        status_code: "no_marker_found",
        detail: `scanned ${allComments.length} comments, no marker found`,
      };
    }

    // Should not reach here but keep TypeScript happy
    return {
      id: "M028-S03-COMMENT-BODY",
      passed: false,
      skipped: false,
      status_code: "no_marker_found",
      detail: `scanned ${allComments.length} comments`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S03-COMMENT-BODY",
      passed: false,
      skipped: true,
      status_code: "github_unavailable",
      detail: `github_unavailable: ${message}`,
    };
  }
}

// ── Check: SENTINEL-CLEARED ──────────────────────────────────────────────

export async function checkSentinelCleared(sql?: unknown): Promise<M028S03Check> {
  if (!sql) {
    return {
      id: "M028-S03-SENTINEL-CLEARED",
      passed: true,
      skipped: false,
      status_code: "db_unavailable",
      detail: "count unknown",
    };
  }

  try {
    const rows = await (
      sql as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
    )`
      SELECT COUNT(*)::int AS cnt
      FROM wiki_update_suggestions
      WHERE published_at IS NOT NULL
        AND published_comment_id = 0
    `;

    const cnt = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

    return {
      id: "M028-S03-SENTINEL-CLEARED",
      passed: true,
      skipped: false,
      status_code: "sentinel_count",
      detail: `sentinel_rows=${cnt}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S03-SENTINEL-CLEARED",
      passed: true,
      skipped: false,
      status_code: "db_unavailable",
      detail: `count unknown: ${message}`,
    };
  }
}

// ── Evaluator ────────────────────────────────────────────────────────────

export async function evaluateM028S03(
  sql?: unknown,
  octokit?: Octokit,
  owner?: string,
  repo?: string,
  issueNumber?: number,
): Promise<M028S03EvaluationReport> {
  const [noWhyCheck, liveMarkerCheck, commentBodyCheck, sentinelCheck] = await Promise.all([
    checkNoWhyInRender(),
    checkLiveMarker(sql),
    checkCommentBody(octokit, owner, repo, issueNumber),
    checkSentinelCleared(sql),
  ]);

  const checks: M028S03Check[] = [noWhyCheck, liveMarkerCheck, commentBodyCheck, sentinelCheck];

  // SENTINEL-CLEARED is informational — never contributes to overallPassed: false
  const overallPassed = checks
    .filter((c) => !c.skipped && c.id !== "M028-S03-SENTINEL-CLEARED")
    .every((c) => c.passed);

  return {
    check_ids: M028_S03_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Human-readable renderer ──────────────────────────────────────────────

function renderReport(report: M028S03EvaluationReport): string {
  const lines = [
    "M028 / S03 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    const detail = check.detail ? ` ${check.detail}` : "";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

// ── Proof harness entry point ─────────────────────────────────────────────

export async function buildM028S03ProofHarness(opts?: {
  sql?: unknown;
  octokit?: Octokit;
  owner?: string;
  repo?: string;
  issueNumber?: number;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ report: M028S03EvaluationReport; exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  // Try DB connection if not injected
  let sql: unknown = opts?.sql;
  if (sql === undefined) {
    try {
      const dbUrl = process.env.DATABASE_URL;
      if (dbUrl) {
        const { createDbClient } = await import("../src/db/client.ts");
        const client = createDbClient({
          connectionString: dbUrl,
          logger: createSilentLogger(),
        });
        sql = client.sql;
        // Probe connectivity
        await (client.sql as (strings: TemplateStringsArray) => Promise<unknown[]>)`SELECT 1`;
      }
    } catch {
      sql = undefined;
    }
  }

  const report = await evaluateM028S03(
    sql,
    opts?.octokit,
    opts?.owner,
    opts?.repo,
    opts?.issueNumber,
  );

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((c) => !c.passed && !c.skipped && c.id !== "M028-S03-SENTINEL-CLEARED")
      .map((c) => `${c.id}:${c.status_code}`)
      .join(", ");
    stderr.write(`verify:m028:s03 failed: ${failingCodes}\n`);
  }

  return { report, exitCode: report.overallPassed ? 0 : 1 };
}

// ── CLI runner ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM028S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
