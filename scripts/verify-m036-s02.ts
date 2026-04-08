import type { Logger } from "pino";
import {
  applyActivationPolicy,
  shouldAutoActivate,
  DEFAULT_ACTIVATION_THRESHOLD,
  type ApplyActivationPolicyOptions,
  type ActivationPolicyResult,
} from "../src/knowledge/generated-rule-activation.ts";
import {
  getActiveRulesForPrompt,
  formatActiveRulesSection,
  type GetActiveRulesOptions,
  type GetActiveRulesResult,
} from "../src/knowledge/active-rules.ts";
import type { GeneratedRuleStore, GeneratedRuleRecord } from "../src/knowledge/generated-rule-store.ts";

// ---------------------------------------------------------------------------
// Check IDs
// ---------------------------------------------------------------------------

export const M036_S02_CHECK_IDS = [
  "M036-S02-ACTIVATION",
  "M036-S02-PROMPT-INJECTION",
  "M036-S02-FAIL-OPEN",
] as const;

export type M036S02CheckId = (typeof M036_S02_CHECK_IDS)[number];

export type Check = {
  id: M036S02CheckId;
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

// ---------------------------------------------------------------------------
// Logger helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  const logger = {
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    child: () => logger,
  };
  return logger as unknown as Logger;
}

function createSpyLogger(): Logger & { _warnCalls: unknown[][] } {
  const warnCalls: unknown[][] = [];
  const logger = {
    _warnCalls: warnCalls,
    info: (..._args: unknown[]) => {},
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
    error: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
    child: () => logger,
  };
  return logger as unknown as Logger & { _warnCalls: unknown[][] };
}

// ---------------------------------------------------------------------------
// Shared store builder helpers
// ---------------------------------------------------------------------------

function makePendingRule(overrides: Partial<GeneratedRuleRecord> & { id: number; repo: string }): GeneratedRuleRecord {
  return {
    title: "Always guard optional pointers before dereferencing",
    ruleText: "Add an explicit null check before calling methods on nullable pointers. Return early or throw when the pointer is absent.",
    status: "pending",
    origin: "generated",
    signalScore: 0.85,
    memberCount: 7,
    clusterCentroid: new Float32Array([1, 0]),
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:00Z",
    activatedAt: null,
    retiredAt: null,
    ...overrides,
  };
}

function makeActiveRule(base: GeneratedRuleRecord): GeneratedRuleRecord {
  return { ...base, status: "active", activatedAt: "2026-04-04T00:01:00Z" };
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export type ActivationFixtureResult = {
  policyResult: ActivationPolicyResult;
};

export type PromptInjectionFixtureResult = {
  rulesResult: GetActiveRulesResult;
  promptSection: string;
};

export type FailOpenFixtureResult = {
  rulesResult: GetActiveRulesResult;
  warnCount: number;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function runActivationFixture(): Promise<ActivationFixtureResult> {
  const logger = createMockLogger();
  const repo = "xbmc/xbmc";

  const rule = makePendingRule({ id: 1, repo });

  // Store has one high-confidence pending rule; activateRule promotes it.
  const store: GeneratedRuleStore = {
    savePendingRule: async () => { throw new Error("not used"); },
    getRule: async () => null,
    listRulesForRepo: async (_r, opts) => {
      if (opts?.status === "pending") return [rule];
      return [];
    },
    getActiveRulesForRepo: async () => [],
    activateRule: async (id) => {
      if (id === rule.id) return makeActiveRule(rule);
      return null;
    },
    retireRule: async () => null,
    getLifecycleCounts: async () => ({ pending: 1, active: 0, retired: 0, total: 1 }),
  };

  const policyResult = await applyActivationPolicy({ store, logger, repo });
  return { policyResult };
}

async function runPromptInjectionFixture(): Promise<PromptInjectionFixtureResult> {
  const logger = createMockLogger();
  const repo = "xbmc/xbmc";

  // Build an active rule that matches what post-activation would look like.
  const rule = makeActiveRule(makePendingRule({ id: 1, repo }));

  const store: GeneratedRuleStore = {
    savePendingRule: async () => { throw new Error("not used"); },
    getRule: async () => null,
    listRulesForRepo: async () => [],
    getActiveRulesForRepo: async () => [rule],
    activateRule: async () => null,
    retireRule: async () => null,
    getLifecycleCounts: async () => ({ pending: 0, active: 1, retired: 0, total: 1 }),
  };

  const rulesResult = await getActiveRulesForPrompt({ store, repo, logger });
  const promptSection = formatActiveRulesSection(rulesResult.rules);
  return { rulesResult, promptSection };
}

async function runFailOpenFixture(): Promise<FailOpenFixtureResult> {
  const logger = createSpyLogger();
  const repo = "xbmc/xbmc";

  // Store always throws on getActiveRulesForRepo.
  const store: GeneratedRuleStore = {
    savePendingRule: async () => { throw new Error("not used"); },
    getRule: async () => null,
    listRulesForRepo: async () => [],
    getActiveRulesForRepo: async () => {
      throw new Error("simulated DB failure");
    },
    activateRule: async () => null,
    retireRule: async () => null,
    getLifecycleCounts: async () => ({ pending: 0, active: 0, retired: 0, total: 0 }),
  };

  const rulesResult = await getActiveRulesForPrompt({ store, repo, logger });
  return { rulesResult, warnCount: logger._warnCalls.length };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * M036-S02-ACTIVATION
 * Verifies that a high-signal pending rule is promoted to active when
 * applyActivationPolicy runs, and that shouldAutoActivate correctly predicts the
 * promotion.
 */
export async function runActivationCheck(
  _runFn?: () => Promise<ActivationFixtureResult>,
): Promise<Check> {
  const { policyResult } = await (_runFn ?? runActivationFixture)();

  const predicateMatch = shouldAutoActivate(0.85, DEFAULT_ACTIVATION_THRESHOLD) === true;
  const atThresholdBoundary = shouldAutoActivate(DEFAULT_ACTIVATION_THRESHOLD, DEFAULT_ACTIVATION_THRESHOLD) === true;
  const belowThreshold = shouldAutoActivate(DEFAULT_ACTIVATION_THRESHOLD - 0.01, DEFAULT_ACTIVATION_THRESHOLD) === false;
  const predicateBehaviourCorrect = predicateMatch && atThresholdBoundary && belowThreshold;

  const policyActivated = policyResult.activated === 1
    && policyResult.activatedRules.length === 1
    && policyResult.activationFailures === 0
    && policyResult.activatedRules[0]?.status === "active";

  if (predicateBehaviourCorrect && policyActivated) {
    const rule = policyResult.activatedRules[0]!;
    return {
      id: "M036-S02-ACTIVATION",
      passed: true,
      skipped: false,
      status_code: "rule_auto_activated",
      detail: `ruleId=${rule.id} signalScore=${rule.signalScore} threshold=${policyResult.threshold} activated=${policyResult.activated}`,
    };
  }

  const problems: string[] = [];
  if (!predicateBehaviourCorrect) problems.push("shouldAutoActivate predicate returned unexpected values");
  if (policyResult.activated !== 1) problems.push(`activated=${policyResult.activated} expected 1`);
  if (policyResult.activationFailures > 0) problems.push(`activationFailures=${policyResult.activationFailures} expected 0`);
  if (policyResult.activatedRules[0]?.status !== "active") problems.push("activatedRule status is not 'active'");

  return {
    id: "M036-S02-ACTIVATION",
    passed: false,
    skipped: false,
    status_code: "activation_failed",
    detail: problems.join("; "),
  };
}

/**
 * M036-S02-PROMPT-INJECTION
 * Verifies that active rules fetched via getActiveRulesForPrompt are rendered
 * into a prompt section that contains the rule title and text.
 */
export async function runPromptInjectionCheck(
  _runFn?: () => Promise<PromptInjectionFixtureResult>,
): Promise<Check> {
  const { rulesResult, promptSection } = await (_runFn ?? runPromptInjectionFixture)();

  const hasRules = rulesResult.rules.length === 1;
  const sectionPresent = promptSection.includes("## Generated Review Rules");
  const titlePresent = hasRules && promptSection.includes(rulesResult.rules[0]!.title);
  const textPresent = hasRules && promptSection.includes(rulesResult.rules[0]!.ruleText.slice(0, 30));
  const signalLabelPresent = hasRules && promptSection.includes("signal:");

  if (hasRules && sectionPresent && titlePresent && textPresent && signalLabelPresent) {
    const rule = rulesResult.rules[0]!;
    return {
      id: "M036-S02-PROMPT-INJECTION",
      passed: true,
      skipped: false,
      status_code: "rule_injected_into_prompt",
      detail: `ruleId=${rule.id} title="${rule.title}" signalScore=${rule.signalScore} sectionLength=${promptSection.length}`,
    };
  }

  const problems: string[] = [];
  if (!hasRules) problems.push(`rulesResult.rules.length=${rulesResult.rules.length} expected 1`);
  if (!sectionPresent) problems.push("prompt section header missing");
  if (!titlePresent) problems.push("rule title not found in prompt section");
  if (!textPresent) problems.push("rule text not found in prompt section");
  if (!signalLabelPresent) problems.push("signal score label missing");

  return {
    id: "M036-S02-PROMPT-INJECTION",
    passed: false,
    skipped: false,
    status_code: "rule_not_injected",
    detail: problems.join("; "),
  };
}

/**
 * M036-S02-FAIL-OPEN
 * Verifies that when the rule store throws, getActiveRulesForPrompt returns an
 * empty result and emits at least one warn log — review proceeds without rules.
 */
export async function runFailOpenCheck(
  _runFn?: () => Promise<FailOpenFixtureResult>,
): Promise<Check> {
  const { rulesResult, warnCount } = await (_runFn ?? runFailOpenFixture)();

  const emptyResult = rulesResult.rules.length === 0
    && rulesResult.totalActive === 0
    && rulesResult.truncatedCount === 0;
  const warnEmitted = warnCount >= 1;
  const emptySection = formatActiveRulesSection([]) === "";

  if (emptyResult && warnEmitted && emptySection) {
    return {
      id: "M036-S02-FAIL-OPEN",
      passed: true,
      skipped: false,
      status_code: "fail_open_on_store_error",
      detail: `rules.length=0 warnCount=${warnCount} emptySection=true`,
    };
  }

  const problems: string[] = [];
  if (!emptyResult) problems.push(`rules.length=${rulesResult.rules.length} expected 0`);
  if (!warnEmitted) problems.push("no warn log emitted on store error");
  if (!emptySection) problems.push("formatActiveRulesSection([]) returned non-empty string");

  return {
    id: "M036-S02-FAIL-OPEN",
    passed: false,
    skipped: false,
    status_code: "not_fail_open",
    detail: problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Top-level evaluator
// ---------------------------------------------------------------------------

export async function evaluateM036S02(opts?: {
  _activationRunFn?: () => Promise<ActivationFixtureResult>;
  _promptInjectionRunFn?: () => Promise<PromptInjectionFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
}): Promise<EvaluationReport> {
  const [activation, promptInjection, failOpen] = await Promise.all([
    runActivationCheck(opts?._activationRunFn),
    runPromptInjectionCheck(opts?._promptInjectionRunFn),
    runFailOpenCheck(opts?._failOpenRunFn),
  ]);

  const checks: Check[] = [activation, promptInjection, failOpen];
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M036_S02_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M036 S02 proof harness",
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

// ---------------------------------------------------------------------------
// Harness entry point
// ---------------------------------------------------------------------------

export async function buildM036S02ProofHarness(opts?: {
  _activationRunFn?: () => Promise<ActivationFixtureResult>;
  _promptInjectionRunFn?: () => Promise<PromptInjectionFixtureResult>;
  _failOpenRunFn?: () => Promise<FailOpenFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM036S02({
    _activationRunFn: opts?._activationRunFn,
    _promptInjectionRunFn: opts?._promptInjectionRunFn,
    _failOpenRunFn: opts?._failOpenRunFn,
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
    stderr.write(`verify:m036:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM036S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
