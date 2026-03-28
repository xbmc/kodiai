/**
 * M031 proof harness.
 *
 * Five pure-code checks covering all M031 security controls:
 *   - M031-ENV-ALLOWLIST         (pure-code) -- buildAgentEnv strips secrets from subprocess env
 *   - M031-GIT-URL-CLEAN         (pure-code) -- buildAuthFetchUrl returns 'origin' when token is absent
 *   - M031-OUTGOING-SCAN-BLOCKS  (pure-code) -- scanOutgoingForSecrets blocks github-pat patterns
 *   - M031-PROMPT-HAS-SECURITY   (pure-code) -- buildMentionPrompt includes Security Policy section
 *   - M031-CLAUDEMD-HAS-SECURITY (pure-code) -- buildSecurityClaudeMd includes Security Policy section
 *
 * Usage:
 *   bun run verify:m031 [--json]
 *
 * Exit 0 = overallPassed true (all non-skipped checks pass).
 * Exit 1 = at least one non-skipped check failed.
 *
 * Failure diagnostics:
 *   bun run verify:m031 --json 2>&1 | jq '.checks[] | select(.passed == false)'
 */

import { buildAgentEnv } from "../src/execution/env.ts";
import { buildAuthFetchUrl } from "../src/jobs/workspace.ts";
import { scanOutgoingForSecrets } from "../src/lib/sanitizer.ts";
import { buildMentionPrompt } from "../src/execution/mention-prompt.ts";
import { buildSecurityClaudeMd } from "../src/execution/executor.ts";
import type { MentionEvent } from "../src/handlers/mention-types.ts";

// ── Exports and types ────────────────────────────────────────────────────

export const M031_CHECK_IDS = [
  "M031-ENV-ALLOWLIST",
  "M031-GIT-URL-CLEAN",
  "M031-OUTGOING-SCAN-BLOCKS",
  "M031-PROMPT-HAS-SECURITY",
  "M031-CLAUDEMD-HAS-SECURITY",
] as const;

export type M031CheckId = (typeof M031_CHECK_IDS)[number];

export type Check = {
  id: M031CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: Check[];
};

// ── Minimal MentionEvent for prompt check ────────────────────────────────

const MINIMAL_MENTION: MentionEvent = {
  surface: "pr_comment",
  owner: "xbmc",
  repo: "kodiai",
  issueNumber: 3,
  prNumber: 3,
  commentId: 123,
  commentBody: "@kodiai help",
  commentAuthor: "alice",
  commentCreatedAt: "2026-01-01T00:00:00Z",
  headRef: "main",
  baseRef: "main",
  headRepoOwner: "xbmc",
  headRepoName: "kodiai",
  diffHunk: undefined,
  filePath: undefined,
  fileLine: undefined,
  inReplyToId: undefined,
  issueBody: "body",
  issueTitle: "title",
};

// ── Check 1: ENV-ALLOWLIST (pure-code) ───────────────────────────────────

export async function runEnvAllowlist(
  _buildAgentEnvFn?: () => NodeJS.ProcessEnv,
): Promise<Check> {
  const fn = _buildAgentEnvFn ?? buildAgentEnv;

  // Set a secret in process.env before calling the builder
  const prevDb = process.env.DATABASE_URL;
  const prevApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    process.env.DATABASE_URL = "postgres://secret";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const env = fn();

    const dbPresent = "DATABASE_URL" in env;
    const apiKeyPresent = "ANTHROPIC_API_KEY" in env;

    if (!dbPresent && apiKeyPresent) {
      return {
        id: "M031-ENV-ALLOWLIST",
        passed: true,
        skipped: false,
        status_code: "env_allowlist_ok",
        detail: "DATABASE_URL absent, ANTHROPIC_API_KEY present in agent env",
      };
    }

    const problems: string[] = [];
    if (dbPresent) problems.push("DATABASE_URL leaked into agent env");
    if (!apiKeyPresent) problems.push("ANTHROPIC_API_KEY missing from agent env");

    return {
      id: "M031-ENV-ALLOWLIST",
      passed: false,
      skipped: false,
      status_code: "env_allowlist_broken",
      detail: problems.join("; "),
    };
  } finally {
    if (prevDb === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prevDb;
    }
    if (prevApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = prevApiKey;
    }
  }
}

// ── Check 2: GIT-URL-CLEAN (pure-code) ───────────────────────────────────

export async function runGitUrlClean(
  _buildAuthFetchUrlFn?: (dir: string, token: string | undefined) => Promise<string>,
): Promise<Check> {
  const fn = _buildAuthFetchUrlFn ?? buildAuthFetchUrl;

  // Token-absent fast-return path: returns 'origin' without reading the filesystem
  const result = await fn("", undefined);

  const isOrigin = result === "origin";
  const hasToken = result.includes("x-access-token");

  if (isOrigin && !hasToken) {
    return {
      id: "M031-GIT-URL-CLEAN",
      passed: true,
      skipped: false,
      status_code: "git_url_clean",
      detail: `result="${result}" (no token in URL)`,
    };
  }

  const problems: string[] = [];
  if (!isOrigin) problems.push(`result="${result}" expected "origin"`);
  if (hasToken) problems.push("result contains x-access-token");

  return {
    id: "M031-GIT-URL-CLEAN",
    passed: false,
    skipped: false,
    status_code: "git_url_leaks_token",
    detail: problems.join("; "),
  };
}

// ── Check 3: OUTGOING-SCAN-BLOCKS (pure-code) ────────────────────────────

export async function runOutgoingScanBlocks(
  _scanFn?: (text: string) => { blocked: boolean; matchedPattern: string | undefined },
): Promise<Check> {
  const fn = _scanFn ?? scanOutgoingForSecrets;

  // ghp_ prefix + exactly 36 alphanumeric chars to match the github-pat regex
  const testToken = "ghp_abc123AAABBBCCC" + "0".repeat(21); // 15 + 21 = 36 chars after ghp_
  const result = fn(testToken);

  if (result.blocked && result.matchedPattern === "github-pat") {
    return {
      id: "M031-OUTGOING-SCAN-BLOCKS",
      passed: true,
      skipped: false,
      status_code: "outgoing_scan_blocks",
      detail: `blocked=true matchedPattern=github-pat`,
    };
  }

  const problems: string[] = [];
  if (!result.blocked) problems.push("blocked=false (scanner did not block PAT)");
  if (result.matchedPattern !== "github-pat")
    problems.push(`matchedPattern="${result.matchedPattern}" expected "github-pat"`);

  return {
    id: "M031-OUTGOING-SCAN-BLOCKS",
    passed: false,
    skipped: false,
    status_code: "outgoing_scan_broken",
    detail: problems.join("; "),
  };
}

// ── Check 4: PROMPT-HAS-SECURITY (pure-code) ─────────────────────────────

export async function runPromptHasSecurity(
  _buildMentionPromptFn?: (params: Parameters<typeof buildMentionPrompt>[0]) => string,
): Promise<Check> {
  const fn = _buildMentionPromptFn ?? buildMentionPrompt;

  const prompt = fn({
    mention: MINIMAL_MENTION,
    mentionContext: "",
    userQuestion: "What does this code do?",
  });

  const hasSecuritySection = prompt.includes("## Security Policy");
  const hasRefusal = prompt.includes("I can't help with that");

  if (hasSecuritySection && hasRefusal) {
    return {
      id: "M031-PROMPT-HAS-SECURITY",
      passed: true,
      skipped: false,
      status_code: "prompt_has_security",
      detail: `prompt contains "## Security Policy" and "I can't help with that"`,
    };
  }

  const missing: string[] = [];
  if (!hasSecuritySection) missing.push('"## Security Policy"');
  if (!hasRefusal) missing.push('"I can\'t help with that"');

  return {
    id: "M031-PROMPT-HAS-SECURITY",
    passed: false,
    skipped: false,
    status_code: "prompt_missing_security",
    detail: `prompt missing: ${missing.join(", ")}`,
  };
}

// ── Check 5: CLAUDEMD-HAS-SECURITY (pure-code) ───────────────────────────

export async function runClaudeMdHasSecurity(
  _buildClaudeMdFn?: () => string,
): Promise<Check> {
  const fn = _buildClaudeMdFn ?? buildSecurityClaudeMd;

  const md = fn();

  const hasSecurityHeading = md.includes("# Security Policy");
  const hasRefusal = md.includes("I can't help with that");

  if (hasSecurityHeading && hasRefusal) {
    return {
      id: "M031-CLAUDEMD-HAS-SECURITY",
      passed: true,
      skipped: false,
      status_code: "claudemd_has_security",
      detail: `CLAUDE.md contains "# Security Policy" and "I can't help with that"`,
    };
  }

  const missing: string[] = [];
  if (!hasSecurityHeading) missing.push('"# Security Policy"');
  if (!hasRefusal) missing.push('"I can\'t help with that"');

  return {
    id: "M031-CLAUDEMD-HAS-SECURITY",
    passed: false,
    skipped: false,
    status_code: "claudemd_missing_security",
    detail: `CLAUDE.md missing: ${missing.join(", ")}`,
  };
}

// ── Evaluator ────────────────────────────────────────────────────────────

export async function evaluateM031(opts?: {
  _buildAgentEnvFn?: () => NodeJS.ProcessEnv;
  _buildAuthFetchUrlFn?: (dir: string, token: string | undefined) => Promise<string>;
  _scanFn?: (text: string) => { blocked: boolean; matchedPattern: string | undefined };
  _buildMentionPromptFn?: (params: Parameters<typeof buildMentionPrompt>[0]) => string;
  _buildClaudeMdFn?: () => string;
}): Promise<EvaluationReport> {
  const [envAllowlist, gitUrlClean, outgoingScanBlocks, promptHasSecurity, claudeMdHasSecurity] =
    await Promise.all([
      runEnvAllowlist(opts?._buildAgentEnvFn),
      runGitUrlClean(opts?._buildAuthFetchUrlFn),
      runOutgoingScanBlocks(opts?._scanFn),
      runPromptHasSecurity(opts?._buildMentionPromptFn),
      runClaudeMdHasSecurity(opts?._buildClaudeMdFn),
    ]);

  const checks: Check[] = [
    envAllowlist,
    gitUrlClean,
    outgoingScanBlocks,
    promptHasSecurity,
    claudeMdHasSecurity,
  ];

  // All non-skipped checks gate overallPassed
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M031_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Human-readable renderer ──────────────────────────────────────────────

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M031 proof harness",
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

export async function buildM031ProofHarness(opts?: {
  _buildAgentEnvFn?: () => NodeJS.ProcessEnv;
  _buildAuthFetchUrlFn?: (dir: string, token: string | undefined) => Promise<string>;
  _scanFn?: (text: string) => { blocked: boolean; matchedPattern: string | undefined };
  _buildMentionPromptFn?: (params: Parameters<typeof buildMentionPrompt>[0]) => string;
  _buildClaudeMdFn?: () => string;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM031({
    _buildAgentEnvFn: opts?._buildAgentEnvFn,
    _buildAuthFetchUrlFn: opts?._buildAuthFetchUrlFn,
    _scanFn: opts?._scanFn,
    _buildMentionPromptFn: opts?._buildMentionPromptFn,
    _buildClaudeMdFn: opts?._buildClaudeMdFn,
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
    stderr.write(`verify:m031 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

// ── CLI runner ────────────────────────────────────────────────────────────

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM031ProofHarness({ json: useJson });
  process.exit(exitCode);
}
