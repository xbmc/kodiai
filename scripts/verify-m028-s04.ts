/**
 * M028 / S04 proof harness.
 *
 * Five checks:
 *   - M028-S04-NO-WHY-IN-RENDER    (pure-code) — formatPageComment has no **Why:** or :warning:
 *   - M028-S04-NO-WHY-IN-SUMMARY   (pure-code) — formatSummaryTable has no Why/warning/Wiki Update Suggestions
 *   - M028-S04-LIVE-PUBLISHED      (DB-gated)  — at least 80 published rows with real comment IDs
 *   - M028-S04-SENTINEL-SUPERSEDED (DB-gated)  — zero sentinel rows (published_comment_id=0 AND published_at IS NOT NULL)
 *   - M028-S04-DRY-RUN-CLEAN       (pure-code) — formatPageComment top-of-stack returns no Why/warning:
 *
 * Usage:
 *   bun run verify:m028:s04 [--json]
 *
 * Exit 0 = overallPassed true (all non-skipped checks pass).
 * Exit 1 = at least one non-skipped check failed.
 *
 * Failure diagnostics:
 *   bun run verify:m028:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'
 *   SELECT page_id, published_comment_id FROM wiki_update_suggestions WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 30
 */

import { formatPageComment, formatSummaryTable } from "../src/knowledge/wiki-publisher.ts";
import { checkNoWhyInRender } from "./verify-m028-s03.ts";
import type { PageSuggestionGroup } from "../src/knowledge/wiki-publisher-types.ts";
import type { Logger } from "pino";

// ── Exports and types ────────────────────────────────────────────────────

export const M028_S04_CHECK_IDS = [
  "M028-S04-NO-WHY-IN-RENDER",
  "M028-S04-NO-WHY-IN-SUMMARY",
  "M028-S04-LIVE-PUBLISHED",
  "M028-S04-SENTINEL-SUPERSEDED",
  "M028-S04-DRY-RUN-CLEAN",
] as const;

export type M028S04CheckId = (typeof M028_S04_CHECK_IDS)[number];

export type M028S04Check = {
  id: M028S04CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M028S04EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M028S04Check[];
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

async function runNoWhyInRender(
  _formatFn?: (group: PageSuggestionGroup, prOwner: string, prRepo: string) => string,
): Promise<M028S04Check> {
  const s03result = await checkNoWhyInRender(_formatFn);
  return {
    id: "M028-S04-NO-WHY-IN-RENDER",
    passed: s03result.passed,
    skipped: s03result.skipped,
    status_code: s03result.status_code,
    detail: s03result.detail,
  };
}

// ── Check: NO-WHY-IN-SUMMARY ─────────────────────────────────────────────

async function runNoWhyInSummary(
  _summaryFn?: (date: string, results: unknown[], count: number) => string,
): Promise<M028S04Check> {
  const fn =
    _summaryFn ??
    ((date: string, results: unknown[], count: number) =>
      formatSummaryTable(date, results as Parameters<typeof formatSummaryTable>[1], count));

  const rendered = fn("2026-01-01", [], 0);

  for (const forbidden of ["**Why:**", ":warning:", "Wiki Update Suggestions"]) {
    if (rendered.includes(forbidden)) {
      const idx = rendered.indexOf(forbidden);
      const snippet = rendered.slice(Math.max(0, idx - 20), idx + 50);
      return {
        id: "M028-S04-NO-WHY-IN-SUMMARY",
        passed: false,
        skipped: false,
        status_code: "why_found_in_summary",
        detail: `found=${JSON.stringify(forbidden)} snippet=${JSON.stringify(snippet)}`,
      };
    }
  }

  return {
    id: "M028-S04-NO-WHY-IN-SUMMARY",
    passed: true,
    skipped: false,
    status_code: "no_why_in_summary",
    detail: `summary_clean length=${rendered.length}`,
  };
}

// ── Check: LIVE-PUBLISHED ────────────────────────────────────────────────

async function runLivePublished(sql?: unknown): Promise<M028S04Check> {
  if (!sql) {
    return {
      id: "M028-S04-LIVE-PUBLISHED",
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
      WHERE published_comment_id > 0
    `;

    const cnt = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

    if (cnt >= 80) {
      return {
        id: "M028-S04-LIVE-PUBLISHED",
        passed: true,
        skipped: false,
        status_code: "live_published",
        detail: `count=${cnt}`,
      };
    }

    return {
      id: "M028-S04-LIVE-PUBLISHED",
      passed: false,
      skipped: false,
      status_code: "insufficient_published",
      detail: `count=${cnt} (need >= 80)`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S04-LIVE-PUBLISHED",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Check: SENTINEL-SUPERSEDED ───────────────────────────────────────────

async function runSentinelSuperseded(sql?: unknown): Promise<M028S04Check> {
  if (!sql) {
    return {
      id: "M028-S04-SENTINEL-SUPERSEDED",
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
      WHERE published_comment_id = 0
        AND published_at IS NOT NULL
    `;

    const cnt = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

    if (cnt === 0) {
      return {
        id: "M028-S04-SENTINEL-SUPERSEDED",
        passed: true,
        skipped: false,
        status_code: "sentinel_superseded",
        detail: "sentinel_rows=0",
      };
    }

    return {
      id: "M028-S04-SENTINEL-SUPERSEDED",
      passed: false,
      skipped: false,
      status_code: "sentinel_rows_remain",
      detail: `sentinel_rows=${cnt} (need 0; run re-publish to supersede)`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S04-SENTINEL-SUPERSEDED",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Check: DRY-RUN-CLEAN ─────────────────────────────────────────────────

async function runDryRunClean(
  _formatFn?: (group: PageSuggestionGroup, prOwner: string, prRepo: string) => string,
): Promise<M028S04Check> {
  const fn = _formatFn ?? formatPageComment;

  const group: PageSuggestionGroup = {
    pageId: 42,
    pageTitle: "Dry Run Test Page",
    suggestions: [
      {
        sectionHeading: "Installation",
        suggestion: "Update the installation steps.",
        whySummary: "PR #100 has updated steps.",
        citingPrs: [{ prNumber: 100, prTitle: "Update install docs" }],
        voiceMismatchWarning: false,
      },
    ],
  };

  const rendered = fn(group, "xbmc", "xbmc");

  if (rendered.includes("**Why:**")) {
    const idx = rendered.indexOf("**Why:**");
    const snippet = rendered.slice(Math.max(0, idx - 20), idx + 40);
    return {
      id: "M028-S04-DRY-RUN-CLEAN",
      passed: false,
      skipped: false,
      status_code: "why_found_in_dry_run",
      detail: `why_found snippet=${JSON.stringify(snippet)}`,
    };
  }

  if (rendered.includes(":warning:")) {
    const idx = rendered.indexOf(":warning:");
    const snippet = rendered.slice(Math.max(0, idx - 20), idx + 40);
    return {
      id: "M028-S04-DRY-RUN-CLEAN",
      passed: false,
      skipped: false,
      status_code: "why_found_in_dry_run",
      detail: `warning_emoji_found snippet=${JSON.stringify(snippet)}`,
    };
  }

  return {
    id: "M028-S04-DRY-RUN-CLEAN",
    passed: true,
    skipped: false,
    status_code: "dry_run_clean",
    detail: `render_clean length=${rendered.length}`,
  };
}

// ── Evaluator ────────────────────────────────────────────────────────────

export async function evaluateM028S04(opts?: {
  sql?: unknown;
  _formatFn?: (group: PageSuggestionGroup, prOwner: string, prRepo: string) => string;
  _summaryFn?: (date: string, results: unknown[], count: number) => string;
}): Promise<M028S04EvaluationReport> {
  const sql = opts?.sql;

  const [noWhyRender, noWhySummary, livePublished, sentinelSuperseded, dryRunClean] =
    await Promise.all([
      runNoWhyInRender(opts?._formatFn),
      runNoWhyInSummary(opts?._summaryFn),
      runLivePublished(sql),
      runSentinelSuperseded(sql),
      runDryRunClean(opts?._formatFn),
    ]);

  const checks: M028S04Check[] = [
    noWhyRender,
    noWhySummary,
    livePublished,
    sentinelSuperseded,
    dryRunClean,
  ];

  // All non-skipped checks gate overallPassed — SENTINEL-SUPERSEDED is NOT informational
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M028_S04_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Human-readable renderer ──────────────────────────────────────────────

function renderReport(report: M028S04EvaluationReport): string {
  const lines = [
    "M028 / S04 proof harness",
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

export async function buildM028S04ProofHarness(opts?: {
  sql?: unknown;
  _formatFn?: (group: PageSuggestionGroup, prOwner: string, prRepo: string) => string;
  _summaryFn?: (date: string, results: unknown[], count: number) => string;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
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

  const report = await evaluateM028S04({ sql, _formatFn: opts?._formatFn, _summaryFn: opts?._summaryFn });

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((c) => !c.passed && !c.skipped)
      .map((c) => `${c.id}:${c.status_code}`)
      .join(", ");
    stderr.write(`verify:m028:s04 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

// ── CLI runner ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM028S04ProofHarness({ json: useJson });
  process.exit(exitCode);
}
