/**
 * M029 / S04 proof harness.
 *
 * Five checks:
 *   - M029-S04-CONTENT-FILTER-REJECTS (pure-code)     — isReasoningProse rejects reasoning starters
 *   - M029-S04-PROMPT-BANS-META       (pure-code)     — buildVoicePreservingPrompt includes "## Output Contract" and "Do NOT"
 *   - M029-S04-NO-REASONING-IN-DB     (DB-gated)      — zero rows with reasoning-prose suggestions
 *   - M029-S04-LIVE-PUBLISHED         (DB-gated)      — at least 1 published row (published_at IS NOT NULL)
 *   - M029-S04-ISSUE-CLEAN            (GitHub-gated)  — zero unmarked comments on issue #5 (xbmc/wiki)
 *
 * Usage:
 *   bun run verify:m029:s04 [--json]
 *
 * Exit 0 = overallPassed true (all non-skipped checks pass).
 * Exit 1 = at least one non-skipped check failed.
 *
 * Failure diagnostics:
 *   bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'
 *   SELECT suggestion FROM wiki_update_suggestions WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'
 */

import { isReasoningProse } from "../src/knowledge/wiki-voice-validator.ts";
import { buildVoicePreservingPrompt } from "../src/knowledge/wiki-voice-analyzer.ts";
import type { PageStyleDescription, StyleExemplar } from "../src/knowledge/wiki-voice-types.ts";
import type { Logger } from "pino";

// ── Exports and types ────────────────────────────────────────────────────

export const M029_S04_CHECK_IDS = [
  "M029-S04-CONTENT-FILTER-REJECTS",
  "M029-S04-PROMPT-BANS-META",
  "M029-S04-NO-REASONING-IN-DB",
  "M029-S04-LIVE-PUBLISHED",
  "M029-S04-ISSUE-CLEAN",
] as const;

export type M029S04CheckId = (typeof M029_S04_CHECK_IDS)[number];

export type M029S04Check = {
  id: M029S04CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M029S04EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M029S04Check[];
};

// ── Silent logger for internal use ───────────────────────────────────────

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

// ── Check 1: CONTENT-FILTER-REJECTS (pure-code) ──────────────────────────

async function runContentFilterRejects(
  _contentFilterFn?: (text: string) => boolean,
): Promise<M029S04Check> {
  const fn = _contentFilterFn ?? isReasoningProse;
  const testPhrase = "I'll analyze the evidence from PR #27909";
  const result = fn(testPhrase);

  if (result) {
    return {
      id: "M029-S04-CONTENT-FILTER-REJECTS",
      passed: true,
      skipped: false,
      status_code: "content_filter_rejects",
      detail: `isReasoningProse("${testPhrase}") = true`,
    };
  }

  return {
    id: "M029-S04-CONTENT-FILTER-REJECTS",
    passed: false,
    skipped: false,
    status_code: "content_filter_broken",
    detail: `isReasoningProse("${testPhrase}") returned false — filter not rejecting reasoning prose`,
  };
}

// ── Check 2: PROMPT-BANS-META (pure-code) ────────────────────────────────

async function runPromptBansMeta(
  _promptBuilderFn?: (opts: {
    styleDescription: PageStyleDescription;
    exemplarSections: StyleExemplar[];
    originalSection: string;
    sectionHeading: string | null;
    diffEvidence: string;
  }) => string,
): Promise<M029S04Check> {
  const fn = _promptBuilderFn ?? buildVoicePreservingPrompt;

  const styleDescription: PageStyleDescription = {
    pageTitle: "Test",
    styleText: "imperative",
    formattingElements: [],
    mediaWikiMarkup: [],
    tokenCount: 0,
    wikiConventions: {
      categories: [],
      interwikiLinks: [],
      navboxes: [],
      templates: [],
    },
  };

  const prompt = fn({
    styleDescription,
    exemplarSections: [],
    originalSection: "Original",
    sectionHeading: "Test",
    diffEvidence: "PR #1 changed X",
  });

  const hasContract = prompt.includes("## Output Contract");
  const hasDont = prompt.includes("Do NOT");

  if (hasContract && hasDont) {
    return {
      id: "M029-S04-PROMPT-BANS-META",
      passed: true,
      skipped: false,
      status_code: "prompt_bans_meta",
      detail: `prompt contains "## Output Contract" and "Do NOT"`,
    };
  }

  const missing: string[] = [];
  if (!hasContract) missing.push("## Output Contract");
  if (!hasDont) missing.push("Do NOT");

  return {
    id: "M029-S04-PROMPT-BANS-META",
    passed: false,
    skipped: false,
    status_code: "prompt_missing_contract",
    detail: `prompt missing: ${missing.map((s) => JSON.stringify(s)).join(", ")}`,
  };
}

// ── Check 3: NO-REASONING-IN-DB (DB-gated) ───────────────────────────────

async function runNoReasoningInDb(sql?: unknown): Promise<M029S04Check> {
  if (!sql) {
    return {
      id: "M029-S04-NO-REASONING-IN-DB",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: "db_unavailable: no sql connection",
    };
  }

  try {
    const pattern = "^(I'll|Let me|I will|I need to|Looking at)";
    const rows = await (
      sql as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
    )`
      SELECT COUNT(*)::int AS cnt
      FROM wiki_update_suggestions
      WHERE suggestion ~* ${pattern}
    `;

    const cnt = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

    if (cnt === 0) {
      return {
        id: "M029-S04-NO-REASONING-IN-DB",
        passed: true,
        skipped: false,
        status_code: "no_reasoning_in_db",
        detail: "reasoning_rows=0",
      };
    }

    return {
      id: "M029-S04-NO-REASONING-IN-DB",
      passed: false,
      skipped: false,
      status_code: "reasoning_rows_found",
      detail: `count=${cnt} (run DB cleanup step to delete reasoning-prose rows)`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M029-S04-NO-REASONING-IN-DB",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Check 4: LIVE-PUBLISHED (DB-gated) ───────────────────────────────────

async function runLivePublished(sql?: unknown): Promise<M029S04Check> {
  if (!sql) {
    return {
      id: "M029-S04-LIVE-PUBLISHED",
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
    `;

    const cnt = (rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

    if (cnt > 0) {
      return {
        id: "M029-S04-LIVE-PUBLISHED",
        passed: true,
        skipped: false,
        status_code: "live_published",
        detail: `count=${cnt}`,
      };
    }

    return {
      id: "M029-S04-LIVE-PUBLISHED",
      passed: false,
      skipped: false,
      status_code: "no_published_rows",
      detail: "count=0 (run re-publication step)",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M029-S04-LIVE-PUBLISHED",
      passed: false,
      skipped: true,
      status_code: "db_unavailable",
      detail: `db_unavailable: ${message}`,
    };
  }
}

// ── Check 5: ISSUE-CLEAN (GitHub-gated) ──────────────────────────────────

const WIKI_MODIFICATION_MARKER = "<!-- kodiai:wiki-modification:";
const SUMMARY_TABLE_MARKER = "# Wiki Modification Artifacts";
const ISSUE_NUMBER = 5;
const REPO_OWNER = "xbmc";
const REPO_NAME = "wiki";

async function runIssueClean(octokit?: unknown): Promise<M029S04Check> {
  if (!octokit) {
    return {
      id: "M029-S04-ISSUE-CLEAN",
      passed: false,
      skipped: true,
      status_code: "github_unavailable",
      detail: "github_unavailable: no octokit client",
    };
  }

  try {
    const oct = octokit as {
      rest: {
        issues: {
          listComments: (params: {
            owner: string;
            repo: string;
            issue_number: number;
            per_page: number;
            page: number;
          }) => Promise<{ data: Array<{ id: number; body?: string | null }> }>;
        };
      };
    };

    let violations = 0;

    for (let page = 1; ; page++) {
      const { data } = await oct.rest.issues.listComments({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        issue_number: ISSUE_NUMBER,
        per_page: 100,
        page,
      });

      for (const comment of data) {
        const body = comment.body ?? "";
        const hasMarker = body.includes(WIKI_MODIFICATION_MARKER);
        const isSummaryTable = body.includes(SUMMARY_TABLE_MARKER);
        if (!hasMarker && !isSummaryTable) {
          violations++;
        }
      }

      if (data.length < 100) break;
    }

    if (violations === 0) {
      return {
        id: "M029-S04-ISSUE-CLEAN",
        passed: true,
        skipped: false,
        status_code: "issue_clean",
        detail: `issue #${ISSUE_NUMBER} has no unmarked comments`,
      };
    }

    return {
      id: "M029-S04-ISSUE-CLEAN",
      passed: false,
      skipped: false,
      status_code: "unmarked_comments_found",
      detail: `violations=${violations} (run cleanup-wiki-issue.ts to remove unmarked comments)`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "M029-S04-ISSUE-CLEAN",
      passed: false,
      skipped: true,
      status_code: "github_unavailable",
      detail: `github_unavailable: ${message}`,
    };
  }
}

// ── Evaluator ────────────────────────────────────────────────────────────

export async function evaluateM029S04(opts?: {
  sql?: unknown;
  octokit?: unknown;
  _contentFilterFn?: (text: string) => boolean;
  _promptBuilderFn?: (opts: {
    styleDescription: PageStyleDescription;
    exemplarSections: StyleExemplar[];
    originalSection: string;
    sectionHeading: string | null;
    diffEvidence: string;
  }) => string;
}): Promise<M029S04EvaluationReport> {
  const sql = opts?.sql;
  const octokit = opts?.octokit;

  const [contentFilterRejects, promptBansMeta, noReasoningInDb, livePublished, issueClean] =
    await Promise.all([
      runContentFilterRejects(opts?._contentFilterFn),
      runPromptBansMeta(opts?._promptBuilderFn),
      runNoReasoningInDb(sql),
      runLivePublished(sql),
      runIssueClean(octokit),
    ]);

  const checks: M029S04Check[] = [
    contentFilterRejects,
    promptBansMeta,
    noReasoningInDb,
    livePublished,
    issueClean,
  ];

  // All non-skipped checks gate overallPassed
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M029_S04_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Human-readable renderer ──────────────────────────────────────────────

function renderReport(report: M029S04EvaluationReport): string {
  const lines = [
    "M029 / S04 proof harness",
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

export async function buildM029S04ProofHarness(opts?: {
  sql?: unknown;
  octokit?: unknown;
  _contentFilterFn?: (text: string) => boolean;
  _promptBuilderFn?: (opts: {
    styleDescription: PageStyleDescription;
    exemplarSections: StyleExemplar[];
    originalSection: string;
    sectionHeading: string | null;
    diffEvidence: string;
  }) => string;
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

  // Try GitHub auth if not injected and env vars are present
  let octokit: unknown = opts?.octokit;
  if (octokit === undefined) {
    try {
      const appId = process.env.GITHUB_APP_ID;
      const privateKeyEnv = process.env.GITHUB_PRIVATE_KEY ?? process.env.GITHUB_PRIVATE_KEY_BASE64;
      if (appId && privateKeyEnv) {
        const { createGitHubApp } = await import("../src/auth/github-app.ts");
        const { default: pino } = await import("pino");
        const logger = pino({ level: "silent" });

        // Load private key (PEM, file path, or base64)
        let privateKey = privateKeyEnv;
        if (!privateKeyEnv.startsWith("-----BEGIN")) {
          if (privateKeyEnv.startsWith("/") || privateKeyEnv.startsWith("./")) {
            privateKey = await Bun.file(privateKeyEnv).text();
          } else {
            privateKey = atob(privateKeyEnv);
          }
        }

        const appConfig = {
          githubAppId: appId,
          githubPrivateKey: privateKey,
          webhookSecret: "unused",
          slackSigningSecret: "unused",
          slackBotToken: "unused",
          slackBotUserId: "unused",
          slackKodiaiChannelId: "unused",
          slackDefaultRepo: "unused",
          slackAssistantModel: "unused",
          slackWebhookRelaySources: [],
          port: 3000,
          logLevel: "silent",
          botAllowList: [],
          slackWikiChannelId: "",
          wikiStalenessThresholdDays: 30,
          wikiGithubOwner: "",
          wikiGithubRepo: "",
          botUserPat: "",
          botUserLogin: "",
          addonRepos: [],
          mcpInternalBaseUrl: "",
          acaJobImage: "",
          acaResourceGroup: "rg-kodiai",
          acaJobName: "caj-kodiai-agent",
        };

        const githubApp = createGitHubApp(appConfig as Parameters<typeof createGitHubApp>[0], logger);
        await githubApp.initialize();
        const context = await githubApp.getRepoInstallationContext(REPO_OWNER, REPO_NAME);
        if (!context) {
          throw new Error(`No GitHub App installation found for ${REPO_OWNER}/${REPO_NAME}`);
        }
        octokit = await githubApp.getInstallationOctokit(context.installationId);
      }
    } catch {
      octokit = undefined;
    }
  }

  const report = await evaluateM029S04({
    sql,
    octokit,
    _contentFilterFn: opts?._contentFilterFn,
    _promptBuilderFn: opts?._promptBuilderFn,
  });

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
    stderr.write(`verify:m029:s04 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

// ── CLI runner ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM029S04ProofHarness({ json: useJson });
  process.exit(exitCode);
}
