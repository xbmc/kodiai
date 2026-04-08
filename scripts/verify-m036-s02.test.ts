import { describe, expect, test } from "bun:test";
import {
  M036_S02_CHECK_IDS,
  evaluateM036S02,
  buildM036S02ProofHarness,
  runActivationCheck,
  runPromptInjectionCheck,
  runFailOpenCheck,
} from "./verify-m036-s02.ts";
import type {
  EvaluationReport,
  ActivationFixtureResult,
  PromptInjectionFixtureResult,
  FailOpenFixtureResult,
} from "./verify-m036-s02.ts";
import type { ActivationPolicyResult } from "../src/knowledge/generated-rule-activation.ts";
import type { GetActiveRulesResult, SanitizedActiveRule } from "../src/knowledge/active-rules.ts";

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function makeActivationResult(overrides?: Partial<ActivationPolicyResult>): ActivationPolicyResult {
  return {
    repo: "xbmc/xbmc",
    threshold: 0.7,
    pendingEvaluated: 1,
    activated: 1,
    skipped: 0,
    activationFailures: 0,
    activatedRules: [
      {
        id: 1,
        repo: "xbmc/xbmc",
        title: "Guard optional pointers",
        ruleText: "Check before dereferencing.",
        status: "active",
        origin: "generated",
        signalScore: 0.85,
        memberCount: 7,
        clusterCentroid: new Float32Array([1, 0]),
        createdAt: "2026-04-04T00:00:00Z",
        updatedAt: "2026-04-04T00:01:00Z",
        activatedAt: "2026-04-04T00:01:00Z",
        retiredAt: null,
      },
    ],
    durationMs: 10,
    ...overrides,
  };
}

function makeSanitizedRule(overrides?: Partial<SanitizedActiveRule>): SanitizedActiveRule {
  return {
    id: 1,
    title: "Guard optional pointers",
    ruleText: "Check before dereferencing.",
    signalScore: 0.85,
    memberCount: 7,
    ...overrides,
  };
}

function makeGetActiveRulesResult(rules: SanitizedActiveRule[]): GetActiveRulesResult {
  return { rules, totalActive: rules.length, truncatedCount: 0 };
}

// ---------------------------------------------------------------------------
// M036-S02-ACTIVATION
// ---------------------------------------------------------------------------

describe("M036-S02-ACTIVATION", () => {
  test("passes with the real deterministic activation fixture", async () => {
    const result = await runActivationCheck();

    expect(result.id).toBe("M036-S02-ACTIVATION");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("rule_auto_activated");
    expect(result.detail).toContain("activated=1");
    expect(result.detail).toContain("signalScore=0.85");
    expect(result.detail).toContain("threshold=0.7");
  });

  test("fails when no rules were activated", async () => {
    const result = await runActivationCheck(async (): Promise<ActivationFixtureResult> => ({
      policyResult: makeActivationResult({ activated: 0, activatedRules: [] }),
    }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("activation_failed");
    expect(result.detail).toContain("activated=0 expected 1");
  });

  test("fails when activationFailures > 0", async () => {
    const result = await runActivationCheck(async (): Promise<ActivationFixtureResult> => ({
      policyResult: makeActivationResult({ activated: 1, activationFailures: 2 }),
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("activationFailures=2 expected 0");
  });

  test("fails when activated rule status is not 'active'", async () => {
    const result = await runActivationCheck(async (): Promise<ActivationFixtureResult> => ({
      policyResult: makeActivationResult({
        activated: 1,
        activatedRules: [
          {
            id: 1,
            repo: "xbmc/xbmc",
            title: "Rule",
            ruleText: "Text.",
            status: "pending",  // wrong — should be active
            origin: "generated",
            signalScore: 0.85,
            memberCount: 7,
            clusterCentroid: new Float32Array([1, 0]),
            createdAt: "2026-04-04T00:00:00Z",
            updatedAt: "2026-04-04T00:01:00Z",
            activatedAt: null,
            retiredAt: null,
          },
        ],
      }),
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("activatedRule status is not 'active'");
  });
});

// ---------------------------------------------------------------------------
// M036-S02-PROMPT-INJECTION
// ---------------------------------------------------------------------------

describe("M036-S02-PROMPT-INJECTION", () => {
  test("passes with the real deterministic prompt-injection fixture", async () => {
    const result = await runPromptInjectionCheck();

    expect(result.id).toBe("M036-S02-PROMPT-INJECTION");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("rule_injected_into_prompt");
    expect(result.detail).toContain("ruleId=1");
    expect(result.detail).toContain("signal");
  });

  test("fails when no rules are returned by the store", async () => {
    const result = await runPromptInjectionCheck(async (): Promise<PromptInjectionFixtureResult> => ({
      rulesResult: makeGetActiveRulesResult([]),
      promptSection: "",
    }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("rule_not_injected");
    expect(result.detail).toContain("rulesResult.rules.length=0 expected 1");
  });

  test("fails when the section header is missing from the rendered output", async () => {
    const rule = makeSanitizedRule();
    const result = await runPromptInjectionCheck(async (): Promise<PromptInjectionFixtureResult> => ({
      rulesResult: makeGetActiveRulesResult([rule]),
      promptSection: `${rule.title}\n${rule.ruleText}`,  // no ## header
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("prompt section header missing");
  });

  test("fails when rule title is absent from the prompt section", async () => {
    const rule = makeSanitizedRule();
    const result = await runPromptInjectionCheck(async (): Promise<PromptInjectionFixtureResult> => ({
      rulesResult: makeGetActiveRulesResult([rule]),
      promptSection: "## Generated Review Rules\n\nCheck before dereferencing. (signal: 0.85)",
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("rule title not found in prompt section");
  });
});

// ---------------------------------------------------------------------------
// M036-S02-FAIL-OPEN
// ---------------------------------------------------------------------------

describe("M036-S02-FAIL-OPEN", () => {
  test("passes with the real deterministic fail-open fixture", async () => {
    const result = await runFailOpenCheck();

    expect(result.id).toBe("M036-S02-FAIL-OPEN");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.status_code).toBe("fail_open_on_store_error");
    expect(result.detail).toContain("rules.length=0");
    expect(result.detail).toContain("warnCount=1");
    expect(result.detail).toContain("emptySection=true");
  });

  test("fails when rules are returned despite a simulated store error", async () => {
    const result = await runFailOpenCheck(async (): Promise<FailOpenFixtureResult> => ({
      rulesResult: makeGetActiveRulesResult([makeSanitizedRule()]),
      warnCount: 1,
    }));

    expect(result.passed).toBe(false);
    expect(result.status_code).toBe("not_fail_open");
    expect(result.detail).toContain("rules.length=1 expected 0");
  });

  test("fails when no warn log is emitted on store error", async () => {
    const result = await runFailOpenCheck(async (): Promise<FailOpenFixtureResult> => ({
      rulesResult: makeGetActiveRulesResult([]),
      warnCount: 0,
    }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("no warn log emitted on store error");
  });
});

// ---------------------------------------------------------------------------
// evaluateM036S02
// ---------------------------------------------------------------------------

describe("evaluateM036S02", () => {
  test("returns all three check ids and passes with real fixtures", async () => {
    const report = await evaluateM036S02();

    expect(report.check_ids).toStrictEqual(M036_S02_CHECK_IDS);
    expect(report.checks.length).toBe(3);
    expect(report.overallPassed).toBe(true);
    expect(report.checks.every((c) => c.passed && !c.skipped)).toBe(true);
  });

  test("overallPassed is false when one check fails", async () => {
    const report = await evaluateM036S02({
      _activationRunFn: async (): Promise<ActivationFixtureResult> => ({
        policyResult: makeActivationResult({ activated: 0, activatedRules: [] }),
      }),
    });

    expect(report.overallPassed).toBe(false);
    const failing = report.checks.filter((c) => !c.passed && !c.skipped);
    expect(failing.length).toBe(1);
    expect(failing[0]!.id).toBe("M036-S02-ACTIVATION");
  });

  test("overallPassed is false when multiple checks fail", async () => {
    const report = await evaluateM036S02({
      _activationRunFn: async (): Promise<ActivationFixtureResult> => ({
        policyResult: makeActivationResult({ activated: 0, activatedRules: [] }),
      }),
      _promptInjectionRunFn: async (): Promise<PromptInjectionFixtureResult> => ({
        rulesResult: makeGetActiveRulesResult([]),
        promptSection: "",
      }),
    });

    expect(report.overallPassed).toBe(false);
    const failingIds = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failingIds).toContain("M036-S02-ACTIVATION");
    expect(failingIds).toContain("M036-S02-PROMPT-INJECTION");
  });
});

// ---------------------------------------------------------------------------
// buildM036S02ProofHarness
// ---------------------------------------------------------------------------

describe("buildM036S02ProofHarness", () => {
  test("prints text output containing all three check ids", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    const { exitCode } = await buildM036S02ProofHarness({ stdout, stderr });
    const output = chunks.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("M036-S02-ACTIVATION");
    expect(output).toContain("M036-S02-PROMPT-INJECTION");
    expect(output).toContain("M036-S02-FAIL-OPEN");
    expect(output).toContain("Final verdict: PASS");
  });

  test("prints valid JSON in json mode", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM036S02ProofHarness({ stdout, stderr, json: true });
    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;

    expect(parsed.check_ids).toStrictEqual(Array.from(M036_S02_CHECK_IDS));
    expect(parsed.checks.length).toBe(3);
    expect(typeof parsed.overallPassed).toBe("boolean");
    expect(parsed.overallPassed).toBe(true);
  });

  test("returns exitCode 1 and stderr message when a check fails", async () => {
    const stdout = { write: (_s: string) => {} };
    const stderrChunks: string[] = [];
    const stderr = { write: (s: string) => { stderrChunks.push(s); } };

    const { exitCode } = await buildM036S02ProofHarness({
      stdout,
      stderr,
      _failOpenRunFn: async (): Promise<FailOpenFixtureResult> => ({
        rulesResult: makeGetActiveRulesResult([makeSanitizedRule()]),
        warnCount: 0,
      }),
    });

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("verify:m036:s02 failed");
    expect(stderrChunks.join("")).toContain("M036-S02-FAIL-OPEN");
  });

  test("JSON output has correct shape when a check fails", async () => {
    const chunks: string[] = [];
    const stdout = { write: (s: string) => { chunks.push(s); } };
    const stderr = { write: (_s: string) => {} };

    await buildM036S02ProofHarness({
      stdout,
      stderr,
      json: true,
      _activationRunFn: async (): Promise<ActivationFixtureResult> => ({
        policyResult: makeActivationResult({ activated: 0, activatedRules: [] }),
      }),
    });

    const parsed = JSON.parse(chunks.join("")) as EvaluationReport;
    expect(parsed.overallPassed).toBe(false);
    const failing = parsed.checks.filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0]!.id).toBe("M036-S02-ACTIVATION");
  });
});
