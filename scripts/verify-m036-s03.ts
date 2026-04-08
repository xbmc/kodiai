import type { Logger } from "pino";
import {
  applyRetirementPolicy,
  shouldRetireRule,
  DEFAULT_RETIREMENT_FLOOR,
  DEFAULT_MIN_MEMBER_COUNT,
  type ApplyRetirementPolicyOptions,
  type RetirementPolicyResult,
} from "../src/knowledge/generated-rule-retirement.ts";
import {
  notifyLifecycleRun,
  notifyRetirement,
  type NotifyLifecycleRunOptions,
  type NotifyRetirementOptions,
  type LifecycleNotifyResult,
} from "../src/knowledge/generated-rule-notify.ts";
import type { GeneratedRuleStore, GeneratedRuleRecord } from "../src/knowledge/generated-rule-store.ts";
import type { ActivationPolicyResult } from "../src/knowledge/generated-rule-activation.ts";

// ---------------------------------------------------------------------------
// Check IDs
// ---------------------------------------------------------------------------

export const M036_S03_CHECK_IDS = [
  "M036-S03-RETIREMENT",
  "M036-S03-NOTIFY-LIFECYCLE",
  "M036-S03-NOTIFY-FAIL-OPEN",
] as const;

export type M036S03CheckId = (typeof M036_S03_CHECK_IDS)[number];

export type Check = {
  id: M036S03CheckId;
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
// Shared rule builders
// ---------------------------------------------------------------------------

function makeActiveRule(overrides: Partial<GeneratedRuleRecord> & { id: number; repo: string }): GeneratedRuleRecord {
  return {
    title: "Always verify preconditions before mutating shared state",
    ruleText: "Ensure all invariants hold before performing a state mutation that cannot be rolled back.",
    status: "active",
    origin: "generated",
    signalScore: 0.2,     // well below default floor of 0.3 — will trigger retirement
    memberCount: 2,       // below default min of 3
    clusterCentroid: new Float32Array([1, 0]),
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:00Z",
    activatedAt: "2026-04-04T00:01:00Z",
    retiredAt: null,
    ...overrides,
  };
}

function makeRetiredRule(base: GeneratedRuleRecord): GeneratedRuleRecord {
  return { ...base, status: "retired", retiredAt: "2026-04-04T01:00:00Z" };
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export type RetirementFixtureResult = {
  policyResult: RetirementPolicyResult;
};

export type NotifyLifecycleFixtureResult = {
  notifyResult: LifecycleNotifyResult;
  hookCallCount: number;
};

export type NotifyFailOpenFixtureResult = {
  notifyResult: LifecycleNotifyResult;
  warnCount: number;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function runRetirementFixture(): Promise<RetirementFixtureResult> {
  const logger = createMockLogger();
  const repo = "xbmc/xbmc";

  const rule = makeActiveRule({ id: 1, repo });
  const retired = makeRetiredRule(rule);

  const store: GeneratedRuleStore = {
    savePendingRule: async () => { throw new Error("not used"); },
    getRule: async () => null,
    listRulesForRepo: async (_r, opts) => {
      if (opts?.status === "active") return [rule];
      return [];
    },
    getActiveRulesForRepo: async () => [rule],
    activateRule: async () => null,
    retireRule: async (id) => {
      if (id === rule.id) return retired;
      return null;
    },
    getLifecycleCounts: async () => ({ pending: 0, active: 1, retired: 0, total: 1 }),
  };

  const policyResult = await applyRetirementPolicy({ store, logger, repo });
  return { policyResult };
}

async function runNotifyLifecycleFixture(): Promise<NotifyLifecycleFixtureResult> {
  const logger = createMockLogger();
  const repo = "xbmc/xbmc";

  const rule = makeActiveRule({ id: 1, repo });
  const retired = makeRetiredRule(rule);

  // Construct a minimal ActivationPolicyResult with one activated rule.
  const activation: ActivationPolicyResult = {
    repo,
    threshold: 0.7,
    pendingEvaluated: 1,
    activated: 1,
    skipped: 0,
    activationFailures: 0,
    activatedRules: [
      {
        ...rule,
        signalScore: 0.85,
        memberCount: 7,
        status: "active",
        activatedAt: "2026-04-04T00:01:00Z",
      },
    ],
    durationMs: 5,
  };

  // Construct a RetirementPolicyResult with one retired rule.
  const retirement: RetirementPolicyResult = {
    repo,
    floor: DEFAULT_RETIREMENT_FLOOR,
    minMemberCount: DEFAULT_MIN_MEMBER_COUNT,
    activeEvaluated: 1,
    retired: 1,
    kept: 0,
    retirementFailures: 0,
    retiredRules: [retired],
    durationMs: 5,
  };

  let hookCallCount = 0;
  const notifyResult = await notifyLifecycleRun({
    logger,
    activation,
    retirement,
    notifyHook: async (events) => {
      hookCallCount = events.length;
    },
  });

  return { notifyResult, hookCallCount };
}

async function runNotifyFailOpenFixture(): Promise<NotifyFailOpenFixtureResult> {
  const spyLogger = createSpyLogger();
  const repo = "xbmc/xbmc";

  const rule = makeActiveRule({ id: 2, repo });
  const retired = makeRetiredRule(rule);

  // RetirementPolicyResult with one retired rule.
  const retirement: RetirementPolicyResult = {
    repo,
    floor: DEFAULT_RETIREMENT_FLOOR,
    minMemberCount: DEFAULT_MIN_MEMBER_COUNT,
    activeEvaluated: 1,
    retired: 1,
    kept: 0,
    retirementFailures: 0,
    retiredRules: [retired],
    durationMs: 5,
  };

  // Hook that throws.
  const notifyResult = await notifyRetirement({
    logger: spyLogger as unknown as Logger,
    result: retirement,
    notifyHook: async () => {
      throw new Error("simulated hook failure");
    },
  });

  return { notifyResult, warnCount: spyLogger._warnCalls.length };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * M036-S03-RETIREMENT
 * Verifies that a rule with decayed signal (below floor) is retired by
 * applyRetirementPolicy, and that the retirement predicate correctly gates
 * boundary values.
 */
export async function runRetirementCheck(
  _runFn?: () => Promise<RetirementFixtureResult>,
): Promise<Check> {
  const { policyResult } = await (_runFn ?? runRetirementFixture)();

  // Predicate boundary checks
  const belowFloor = shouldRetireRule(
    { signalScore: DEFAULT_RETIREMENT_FLOOR - 0.01, memberCount: 10 } as GeneratedRuleRecord,
    { floor: DEFAULT_RETIREMENT_FLOOR, minMemberCount: DEFAULT_MIN_MEMBER_COUNT },
  );
  const atFloor = shouldRetireRule(
    { signalScore: DEFAULT_RETIREMENT_FLOOR, memberCount: 10 } as GeneratedRuleRecord,
    { floor: DEFAULT_RETIREMENT_FLOOR, minMemberCount: DEFAULT_MIN_MEMBER_COUNT },
  );
  const aboveFloor = shouldRetireRule(
    { signalScore: DEFAULT_RETIREMENT_FLOOR + 0.01, memberCount: 10 } as GeneratedRuleRecord,
    { floor: DEFAULT_RETIREMENT_FLOOR, minMemberCount: DEFAULT_MIN_MEMBER_COUNT },
  );

  const predicateBehaviourCorrect =
    belowFloor.shouldRetire === true &&
    belowFloor.reason === "below-floor" &&
    atFloor.shouldRetire === false &&   // exactly at floor — kept (strict <)
    aboveFloor.shouldRetire === false;

  const policyRetired =
    policyResult.retired === 1 &&
    policyResult.retiredRules.length === 1 &&
    policyResult.retirementFailures === 0 &&
    policyResult.retiredRules[0]?.status === "retired";

  if (predicateBehaviourCorrect && policyRetired) {
    const rule = policyResult.retiredRules[0]!;
    return {
      id: "M036-S03-RETIREMENT",
      passed: true,
      skipped: false,
      status_code: "rule_retired",
      detail: `ruleId=${rule.id} signalScore=${rule.signalScore} floor=${policyResult.floor} retired=${policyResult.retired}`,
    };
  }

  const problems: string[] = [];
  if (!predicateBehaviourCorrect) {
    if (belowFloor.shouldRetire !== true) problems.push(`shouldRetireRule below-floor returned shouldRetire=${belowFloor.shouldRetire}`);
    if (atFloor.shouldRetire !== false) problems.push(`shouldRetireRule at-floor returned shouldRetire=${atFloor.shouldRetire} (expected false — boundary is strict <)`);
    if (aboveFloor.shouldRetire !== false) problems.push(`shouldRetireRule above-floor returned shouldRetire=${aboveFloor.shouldRetire}`);
  }
  if (policyResult.retired !== 1) problems.push(`retired=${policyResult.retired} expected 1`);
  if (policyResult.retirementFailures > 0) problems.push(`retirementFailures=${policyResult.retirementFailures} expected 0`);
  if (policyResult.retiredRules[0]?.status !== "retired") problems.push("retiredRule status is not 'retired'");

  return {
    id: "M036-S03-RETIREMENT",
    passed: false,
    skipped: false,
    status_code: "retirement_failed",
    detail: problems.join("; "),
  };
}

/**
 * M036-S03-NOTIFY-LIFECYCLE
 * Verifies that notifyLifecycleRun emits events for both activation and
 * retirement, calls the notify hook with the combined event count, and
 * reports hook-called=true.
 */
export async function runNotifyLifecycleCheck(
  _runFn?: () => Promise<NotifyLifecycleFixtureResult>,
): Promise<Check> {
  const { notifyResult, hookCallCount } = await (_runFn ?? runNotifyLifecycleFixture)();

  const hasActivationEvents = notifyResult.activationEvents === 1;
  const hasRetirementEvents = notifyResult.retirementEvents === 1;
  const hookCalled = notifyResult.notifyHookCalled === true;
  const hookNotFailed = notifyResult.notifyHookFailed === false;
  // Hook received both activation + retirement events (2 total)
  const hookReceivedAllEvents = hookCallCount === 2;

  if (hasActivationEvents && hasRetirementEvents && hookCalled && hookNotFailed && hookReceivedAllEvents) {
    return {
      id: "M036-S03-NOTIFY-LIFECYCLE",
      passed: true,
      skipped: false,
      status_code: "lifecycle_notified",
      detail: `activationEvents=${notifyResult.activationEvents} retirementEvents=${notifyResult.retirementEvents} hookCalled=${hookCalled} hookCallCount=${hookCallCount}`,
    };
  }

  const problems: string[] = [];
  if (!hasActivationEvents) problems.push(`activationEvents=${notifyResult.activationEvents} expected 1`);
  if (!hasRetirementEvents) problems.push(`retirementEvents=${notifyResult.retirementEvents} expected 1`);
  if (!hookCalled) problems.push("notifyHookCalled=false expected true");
  if (!hookNotFailed) problems.push("notifyHookFailed=true (hook errored unexpectedly)");
  if (!hookReceivedAllEvents) problems.push(`hookCallCount=${hookCallCount} expected 2`);

  return {
    id: "M036-S03-NOTIFY-LIFECYCLE",
    passed: false,
    skipped: false,
    status_code: "notify_lifecycle_failed",
    detail: problems.join("; "),
  };
}

/**
 * M036-S03-NOTIFY-FAIL-OPEN
 * Verifies that when the notify hook throws, the notification function does
 * not propagate the error, sets notifyHookFailed=true, emits at least one
 * warn log, and still returns a result.
 */
export async function runNotifyFailOpenCheck(
  _runFn?: () => Promise<NotifyFailOpenFixtureResult>,
): Promise<Check> {
  const { notifyResult, warnCount } = await (_runFn ?? runNotifyFailOpenFixture)();

  const hookFailed = notifyResult.notifyHookFailed === true;
  const hookCalled = notifyResult.notifyHookCalled === true;
  const warnEmitted = warnCount >= 1;
  const stillReturned = notifyResult.retirementEvents === 1;

  if (hookFailed && hookCalled && warnEmitted && stillReturned) {
    return {
      id: "M036-S03-NOTIFY-FAIL-OPEN",
      passed: true,
      skipped: false,
      status_code: "notify_fail_open",
      detail: `notifyHookFailed=true notifyHookCalled=true warnCount=${warnCount} retirementEvents=${notifyResult.retirementEvents}`,
    };
  }

  const problems: string[] = [];
  if (!hookFailed) problems.push("notifyHookFailed=false expected true");
  if (!hookCalled) problems.push("notifyHookCalled=false expected true (hook should have been called before failing)");
  if (!warnEmitted) problems.push("no warn log emitted on hook failure");
  if (!stillReturned) problems.push(`retirementEvents=${notifyResult.retirementEvents} expected 1 (result should be present despite hook failure)`);

  return {
    id: "M036-S03-NOTIFY-FAIL-OPEN",
    passed: false,
    skipped: false,
    status_code: "not_fail_open",
    detail: problems.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Top-level evaluator
// ---------------------------------------------------------------------------

export async function evaluateM036S03(opts?: {
  _retirementRunFn?: () => Promise<RetirementFixtureResult>;
  _notifyLifecycleRunFn?: () => Promise<NotifyLifecycleFixtureResult>;
  _notifyFailOpenRunFn?: () => Promise<NotifyFailOpenFixtureResult>;
}): Promise<EvaluationReport> {
  const [retirement, notifyLifecycle, notifyFailOpen] = await Promise.all([
    runRetirementCheck(opts?._retirementRunFn),
    runNotifyLifecycleCheck(opts?._notifyLifecycleRunFn),
    runNotifyFailOpenCheck(opts?._notifyFailOpenRunFn),
  ]);

  const checks: Check[] = [retirement, notifyLifecycle, notifyFailOpen];
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M036_S03_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderReport(report: EvaluationReport): string {
  const lines = [
    "M036 S03 proof harness",
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

export async function buildM036S03ProofHarness(opts?: {
  _retirementRunFn?: () => Promise<RetirementFixtureResult>;
  _notifyLifecycleRunFn?: () => Promise<NotifyLifecycleFixtureResult>;
  _notifyFailOpenRunFn?: () => Promise<NotifyFailOpenFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM036S03({
    _retirementRunFn: opts?._retirementRunFn,
    _notifyLifecycleRunFn: opts?._notifyLifecycleRunFn,
    _notifyFailOpenRunFn: opts?._notifyFailOpenRunFn,
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
    stderr.write(`verify:m036:s03 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM036S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
