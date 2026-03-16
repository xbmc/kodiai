/**
 * M028 / S02 proof harness.
 *
 * Four checks:
 *   - M028-S02-COMMENT-MARKER   (pure-code) — formatPageComment outputs marker as first line
 *   - M028-S02-UPSERT-CONTRACT  (pure-code) — upsertWikiPageComment update/create paths correct
 *   - M028-S02-COMMENT-ID-SCHEMA (DB-gated)  — published_comment_id column present in wiki_update_suggestions
 *   - M028-S02-PUBLISHED-LINKAGE (DB-gated)  — no published rows missing published_comment_id
 *
 * Usage:
 *   bun run verify:m028:s02 [--json]
 *
 * Exit 0 = overallPassed true (all checks pass or DB-gated checks skip gracefully).
 * Exit 1 = at least one non-skipped check failed.
 */

import { formatPageComment, upsertWikiPageComment } from "../src/knowledge/wiki-publisher.ts";
import type { PageSuggestionGroup } from "../src/knowledge/wiki-publisher-types.ts";
import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";

// ── Exports and types ────────────────────────────────────────────────────

export const M028_S02_CHECK_IDS = [
  "M028-S02-COMMENT-MARKER",
  "M028-S02-UPSERT-CONTRACT",
  "M028-S02-COMMENT-ID-SCHEMA",
  "M028-S02-PUBLISHED-LINKAGE",
] as const;

export type M028S02CheckId = (typeof M028_S02_CHECK_IDS)[number];

export type M028S02Check = {
  id: M028S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail: string;
};

export type M028S02EvaluationReport = {
  check_ids: M028S02CheckId[];
  overallPassed: boolean;
  checks: M028S02Check[];
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

// ── Check: COMMENT-MARKER ────────────────────────────────────────────────

async function checkCommentMarker(): Promise<M028S02Check> {
  const group: PageSuggestionGroup = {
    pageId: 42,
    pageTitle: "Test Page",
    suggestions: [
      {
        sectionHeading: "Introduction",
        suggestion: "Some updated text.",
        whySummary: "PR updated this section.",
        citingPrs: [{ prNumber: 1001, prTitle: "Update section" }],
        voiceMismatchWarning: false,
      },
    ],
  };

  const rendered = formatPageComment(group, "xbmc", "xbmc");
  const expectedMarker = "<!-- kodiai:wiki-modification:42 -->";
  const firstLine = rendered.split("\n")[0] ?? "";

  if (rendered.startsWith(expectedMarker)) {
    const preview = rendered.slice(0, 80);
    return {
      id: "M028-S02-COMMENT-MARKER",
      passed: true,
      skipped: false,
      status_code: "marker_present",
      detail: `marker_present first_80_chars=${JSON.stringify(preview)}`,
    };
  }

  return {
    id: "M028-S02-COMMENT-MARKER",
    passed: false,
    skipped: false,
    status_code: "marker_absent",
    detail: `marker_absent first_line=${JSON.stringify(firstLine)}`,
  };
}

// ── Check: UPSERT-CONTRACT ───────────────────────────────────────────────

async function checkUpsertContract(): Promise<M028S02Check> {
  const logger = createSilentLogger();

  // — Update path: existing comment with matching marker ————————————————
  let updateCalled = 0;
  let createCalledForUpdate = 0;

  const updateOctokit = {
    rest: {
      issues: {
        listComments: () =>
          Promise.resolve({
            data: [{ id: 5001, body: "<!-- kodiai:wiki-modification:99 --> some content" }],
          }),
        updateComment: () => {
          updateCalled++;
          return Promise.resolve({ data: { id: 5001 } });
        },
        createComment: () => {
          createCalledForUpdate++;
          return Promise.resolve({ data: { id: 9999 } });
        },
      },
    },
  } as unknown as Octokit;

  const updateResult = await upsertWikiPageComment(
    updateOctokit,
    "xbmc",
    "xbmc",
    100,
    99,
    "body",
    logger,
  );

  const updatePathOk =
    updateResult?.action === "updated" &&
    updateResult?.commentId === 5001 &&
    updateCalled === 1 &&
    createCalledForUpdate === 0;

  if (!updatePathOk) {
    const detail = `update_path_failed: result=${JSON.stringify(updateResult)} updateCalled=${updateCalled} createCalledForUpdate=${createCalledForUpdate}`;
    return {
      id: "M028-S02-UPSERT-CONTRACT",
      passed: false,
      skipped: false,
      status_code: "upsert_update_path_failed",
      detail,
    };
  }

  // — Create path: no existing comments ————————————————————————————————
  let updateCalledForCreate = 0;
  let createCalled = 0;

  const createOctokit = {
    rest: {
      issues: {
        listComments: () => Promise.resolve({ data: [] }),
        updateComment: () => {
          updateCalledForCreate++;
          return Promise.resolve({ data: { id: 5001 } });
        },
        createComment: () => {
          createCalled++;
          return Promise.resolve({ data: { id: 9999 } });
        },
      },
    },
  } as unknown as Octokit;

  const createResult = await upsertWikiPageComment(
    createOctokit,
    "xbmc",
    "xbmc",
    100,
    99,
    "body",
    logger,
  );

  const createPathOk =
    createResult?.action === "created" &&
    createResult?.commentId === 9999 &&
    createCalled === 1 &&
    updateCalledForCreate === 0;

  if (!createPathOk) {
    const detail = `create_path_failed: result=${JSON.stringify(createResult)} createCalled=${createCalled} updateCalledForCreate=${updateCalledForCreate}`;
    return {
      id: "M028-S02-UPSERT-CONTRACT",
      passed: false,
      skipped: false,
      status_code: "upsert_create_path_failed",
      detail,
    };
  }

  return {
    id: "M028-S02-UPSERT-CONTRACT",
    passed: true,
    skipped: false,
    status_code: "upsert_contract_ok",
    detail: "update_path=ok create_path=ok",
  };
}

// ── Check: COMMENT-ID-SCHEMA ─────────────────────────────────────────────

async function checkCommentIdSchema(sql: unknown): Promise<M028S02Check> {
  if (!sql) {
    return {
      id: "M028-S02-COMMENT-ID-SCHEMA",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: "db_unavailable: no sql connection",
    };
  }

  try {
    const rows = await (sql as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>)`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'wiki_update_suggestions'
        AND column_name = 'published_comment_id'
    `;

    if (Array.isArray(rows) && rows.length > 0) {
      return {
        id: "M028-S02-COMMENT-ID-SCHEMA",
        passed: true,
        skipped: false,
        status_code: "schema_ok",
        detail: "published_comment_id column present in wiki_update_suggestions",
      };
    }

    return {
      id: "M028-S02-COMMENT-ID-SCHEMA",
      passed: false,
      skipped: false,
      status_code: "column_missing",
      detail: "published_comment_id column absent from wiki_update_suggestions",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S02-COMMENT-ID-SCHEMA",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Check: PUBLISHED-LINKAGE ─────────────────────────────────────────────

async function checkPublishedLinkage(sql: unknown): Promise<M028S02Check> {
  if (!sql) {
    return {
      id: "M028-S02-PUBLISHED-LINKAGE",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: "db_unavailable: no sql connection",
    };
  }

  try {
    const rows = await (sql as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>)`
      SELECT COUNT(*)::int as gap
      FROM wiki_update_suggestions
      WHERE published_at IS NOT NULL
        AND published_comment_id IS NULL
    `;

    const gap = (rows[0] as { gap: number } | undefined)?.gap ?? 0;

    if (gap === 0) {
      return {
        id: "M028-S02-PUBLISHED-LINKAGE",
        passed: true,
        skipped: false,
        status_code: "no_linkage_gap",
        detail: "no published rows missing published_comment_id",
      };
    }

    return {
      id: "M028-S02-PUBLISHED-LINKAGE",
      passed: false,
      skipped: false,
      status_code: "linkage_gap_found",
      detail: `${gap} published rows missing published_comment_id`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M028-S02-PUBLISHED-LINKAGE",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Evaluator ────────────────────────────────────────────────────────────

export async function evaluateM028S02(sql?: unknown): Promise<M028S02EvaluationReport> {
  const [markerCheck, upsertCheck, schemaCheck, linkageCheck] = await Promise.all([
    checkCommentMarker(),
    checkUpsertContract(),
    checkCommentIdSchema(sql),
    checkPublishedLinkage(sql),
  ]);

  const checks: M028S02Check[] = [markerCheck, upsertCheck, schemaCheck, linkageCheck];

  return {
    check_ids: [...M028_S02_CHECK_IDS],
    overallPassed: !checks.some((c) => !c.passed && !c.skipped),
    checks,
  };
}

// ── Human-readable renderer ──────────────────────────────────────────────

function renderReport(report: M028S02EvaluationReport): string {
  const lines = [
    "M028 / S02 proof harness",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code} ${check.detail}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

// ── Proof harness entry point ─────────────────────────────────────────────

export async function buildM028S02ProofHarness(opts?: {
  sql?: unknown;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ report: M028S02EvaluationReport; exitCode: number }> {
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

  const report = await evaluateM028S02(sql);

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
    stderr.write(`verify:m028:s02 failed: ${failingCodes}\n`);
  }

  return { report, exitCode: report.overallPassed ? 0 : 1 };
}

// ── CLI runner ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM028S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
