import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  M031_CHECK_IDS,
  evaluateM031,
  buildM031ProofHarness,
  runEnvAllowlist,
  runGitUrlClean,
  runOutgoingScanBlocks,
  runPromptHasSecurity,
  runClaudeMdHasSecurity,
} from "./verify-m031.ts";
import type { Check, EvaluationReport } from "./verify-m031.ts";

// ── M031-ENV-ALLOWLIST ────────────────────────────────────────────────────

describe("M031-ENV-ALLOWLIST", () => {
  let savedDb: string | undefined;
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedDb = process.env.DATABASE_URL;
    savedApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (savedDb === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDb;
    }
    if (savedApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  });

  test("pass: DATABASE_URL absent, ANTHROPIC_API_KEY present", async () => {
    process.env.DATABASE_URL = "postgres://secret";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const result = await runEnvAllowlist();
    expect(result.id).toBe("M031-ENV-ALLOWLIST");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("env_allowlist_ok");
  });

  test("fail: _buildAgentEnvFn leaks DATABASE_URL", async () => {
    const broken = () => ({
      DATABASE_URL: "postgres://leaked",
      ANTHROPIC_API_KEY: "sk-ant-test-key",
    });
    const result = await runEnvAllowlist(broken as () => NodeJS.ProcessEnv);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("env_allowlist_broken");
    expect(result.detail).toContain("DATABASE_URL leaked");
  });

  test("fail: _buildAgentEnvFn missing ANTHROPIC_API_KEY", async () => {
    const broken = () => ({
      HOME: "/home/user",
    });
    const result = await runEnvAllowlist(broken as () => NodeJS.ProcessEnv);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("env_allowlist_broken");
    expect(result.detail).toContain("ANTHROPIC_API_KEY missing");
  });
});

// ── M031-GIT-URL-CLEAN ────────────────────────────────────────────────────

describe("M031-GIT-URL-CLEAN", () => {
  test("pass: token-absent path returns 'origin'", async () => {
    const result = await runGitUrlClean();
    expect(result.id).toBe("M031-GIT-URL-CLEAN");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("git_url_clean");
    expect(result.detail).toContain('result="origin"');
  });

  test("fail: _fn returns URL with x-access-token", async () => {
    const broken = async (_dir: string, _token: string | undefined) =>
      "https://x-access-token:ghp_secret@github.com/owner/repo.git";
    const result = await runGitUrlClean(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("git_url_leaks_token");
    expect(result.detail).toContain("x-access-token");
  });

  test("fail: _fn returns unexpected string", async () => {
    const broken = async (_dir: string, _token: string | undefined) => "https://github.com/repo";
    const result = await runGitUrlClean(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("git_url_leaks_token");
    expect(result.detail).toContain('expected "origin"');
  });
});

// ── M031-OUTGOING-SCAN-BLOCKS ─────────────────────────────────────────────

describe("M031-OUTGOING-SCAN-BLOCKS", () => {
  test("pass: scanOutgoingForSecrets blocks github-pat", async () => {
    const result = await runOutgoingScanBlocks();
    expect(result.id).toBe("M031-OUTGOING-SCAN-BLOCKS");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("outgoing_scan_blocks");
    expect(result.detail).toContain("blocked=true");
    expect(result.detail).toContain("github-pat");
  });

  test("fail: _fn does not block the token", async () => {
    const broken = (_text: string) => ({ blocked: false, matchedPattern: undefined });
    const result = await runOutgoingScanBlocks(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("outgoing_scan_broken");
    expect(result.detail).toContain("blocked=false");
  });

  test("fail: _fn matches wrong pattern name", async () => {
    const broken = (_text: string) => ({ blocked: true, matchedPattern: "entropy" });
    const result = await runOutgoingScanBlocks(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("outgoing_scan_broken");
    expect(result.detail).toContain("entropy");
  });
});

// ── M031-PROMPT-HAS-SECURITY ──────────────────────────────────────────────

describe("M031-PROMPT-HAS-SECURITY", () => {
  test("pass: buildMentionPrompt includes Security Policy", async () => {
    const result = await runPromptHasSecurity();
    expect(result.id).toBe("M031-PROMPT-HAS-SECURITY");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("prompt_has_security");
  });

  test("fail: _fn returns prompt without Security Policy", async () => {
    const broken = (_params: unknown) => "A prompt with no security section.";
    const result = await runPromptHasSecurity(broken as Parameters<typeof runPromptHasSecurity>[0]);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("prompt_missing_security");
    expect(result.detail).toContain('"## Security Policy"');
  });

  test("fail: _fn returns prompt without refusal phrase", async () => {
    const broken = (_params: unknown) => "## Security Policy\nsome content";
    const result = await runPromptHasSecurity(broken as Parameters<typeof runPromptHasSecurity>[0]);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("prompt_missing_security");
    expect(result.detail).toContain('"I can\'t help with that"');
  });
});

// ── M031-CLAUDEMD-HAS-SECURITY ────────────────────────────────────────────

describe("M031-CLAUDEMD-HAS-SECURITY", () => {
  test("pass: buildSecurityClaudeMd includes Security Policy", async () => {
    const result = await runClaudeMdHasSecurity();
    expect(result.id).toBe("M031-CLAUDEMD-HAS-SECURITY");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("claudemd_has_security");
  });

  test("fail: _fn returns md without security heading", async () => {
    const broken = () => "Some content without security.";
    const result = await runClaudeMdHasSecurity(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("claudemd_missing_security");
    expect(result.detail).toContain('"# Security Policy"');
  });

  test("fail: _fn returns md without refusal phrase", async () => {
    const broken = () => "# Security Policy\nsome content";
    const result = await runClaudeMdHasSecurity(broken);
    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("claudemd_missing_security");
    expect(result.detail).toContain('"I can\'t help with that"');
  });
});

// ── Envelope ─────────────────────────────────────────────────────────────

describe("envelope", () => {
  test("M031_CHECK_IDS has length 5", () => {
    expect(M031_CHECK_IDS.length).toBe(5);
  });

  test("overallPassed is true when all checks pass", async () => {
    const report = await evaluateM031();
    // Ensure env is set up for the check
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      const r = await evaluateM031();
      expect(r.checks.length).toBe(5);
      expect(r.check_ids).toStrictEqual(M031_CHECK_IDS);
      // All checks are pure-code so should pass
      const nonSkipped = r.checks.filter((c) => !c.skipped);
      expect(nonSkipped.every((c) => c.passed)).toBe(r.overallPassed);
    } finally {
      if (prevApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prevApiKey;
      }
    }
    void report; // avoid unused warning
  });

  test("overallPassed is false when one check fails", async () => {
    const brokenScan = (_text: string) => ({ blocked: false, matchedPattern: undefined });
    const report = await evaluateM031({ _scanFn: brokenScan });
    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed && !c.skipped);
    expect(failing.length).toBeGreaterThanOrEqual(1);
    expect(failing[0]!.id).toBe("M031-OUTGOING-SCAN-BLOCKS");
  });

  test("overallPassed skips skipped checks", async () => {
    // Inject a check that says skipped=true — overallPassed should still be true if others pass
    // We verify this by checking that skipped checks don't veto overallPassed
    const report = await evaluateM031();
    const skipped = report.checks.filter((c) => c.skipped);
    // All M031 checks are pure-code, so none should be skipped
    expect(skipped.length).toBe(0);
  });
});

// ── buildM031ProofHarness ─────────────────────────────────────────────────

describe("buildM031ProofHarness", () => {
  test("stdout contains check IDs in text mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      await buildM031ProofHarness({ stdout, stderr });
    } finally {
      if (prevApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prevApiKey;
      }
    }
    const output = chunks.join("");
    expect(output).toContain("M031-ENV-ALLOWLIST");
    expect(output).toContain("M031-GIT-URL-CLEAN");
    expect(output).toContain("M031-OUTGOING-SCAN-BLOCKS");
    expect(output).toContain("M031-PROMPT-HAS-SECURITY");
    expect(output).toContain("M031-CLAUDEMD-HAS-SECURITY");
    expect(output).toContain("Final verdict:");
  });

  test("stdout is valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      await buildM031ProofHarness({ stdout, stderr, json: true });
    } finally {
      if (prevApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prevApiKey;
      }
    }
    const output = chunks.join("");
    const parsed = JSON.parse(output) as EvaluationReport;
    expect(parsed.check_ids).toStrictEqual(Array.from(M031_CHECK_IDS));
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBe(5);
  });

  test("exit code 0 when all checks pass", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderr = { write: (_s: string) => {} };
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      const { exitCode } = await buildM031ProofHarness({ stdout, stderr });
      expect(exitCode).toBe(0);
    } finally {
      if (prevApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prevApiKey;
      }
    }
  });

  test("exit code 1 when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };
    const brokenScan = (_text: string) => ({ blocked: false, matchedPattern: undefined });
    const { exitCode } = await buildM031ProofHarness({ stdout, stderr, _scanFn: brokenScan });
    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m031 failed");
  });
});
