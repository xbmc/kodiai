import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { loadRepoConfig } from "../src/execution/config.ts";
import {
  buildReviewPlan,
  resolveGraphValidationPlanStatus,
  toReviewPlanDetailsSummary,
  type GraphValidationPlanStatus,
  type ReviewPlan,
  type ReviewPlanInput,
} from "../src/review-orchestration/review-plan.ts";
import {
  validateGraphAmplifiedFindings,
  type GraphValidationResult,
  type ValidatedFinding,
} from "../src/review-graph/validation.ts";
import type { ReviewGraphBlastRadiusResult } from "../src/review-graph/query.ts";

export const M067_S02_CHECK_IDS = [
  "CONFIG-REACHABILITY",
  "PLAN-DETAILS-STATES",
  "VALIDATION-SEMANTICS",
  "NO-RAW-LEAKS",
] as const;

export type M067S02CheckId = (typeof M067_S02_CHECK_IDS)[number];

export type M067S02StatusCode =
  | "m067_s02_ok"
  | "m067_s02_contract_failed"
  | "m067_s02_invalid_arg";

export type M067S02CheckStatusCode =
  | "config_reachability_ok"
  | "config_reachability_failed"
  | "plan_details_states_ok"
  | "plan_details_states_failed"
  | "validation_semantics_ok"
  | "validation_semantics_invalid"
  | "no_raw_leaks"
  | "raw_leaks_detected";

export type M067S02Check = {
  id: M067S02CheckId;
  passed: boolean;
  status_code: M067S02CheckStatusCode;
  detail: string;
};

export type M067S02Scenario = {
  name: "default-disabled" | "enabled-no-query" | "enabled-with-graph" | "final-applied";
  expected_status: GraphValidationPlanStatus;
  actual_status: GraphValidationPlanStatus;
  reason: string | undefined;
  review_plan_line_count: number;
  review_plan_line: string;
  config_snapshot: {
    reviewPlan: {
      status: ReviewPlan["status"];
      hash: string;
      graphValidationStatus: GraphValidationPlanStatus;
    };
  };
};

export type M067S02ConfigEvidence = {
  enabled_value: boolean;
  default_value: boolean;
  enabled_warning_count: number;
  default_warning_count: number;
};

export type M067S02ValidationEvidence = {
  succeeded: boolean;
  validatedCount: number;
  confirmedCount: number;
  uncertainCount: number;
  verdicts: Array<ValidatedFinding<{ id: string; filePath: string; title: string; severity: string }>["graphValidationVerdict"]>;
  errorMessage?: string;
};

export type M067S02Report = {
  command: "verify:m067:s02";
  generated_at: string;
  success: boolean;
  status_code: M067S02StatusCode;
  check_ids: M067S02CheckId[];
  checks: M067S02Check[];
  failing_check_id: M067S02CheckId | null;
  issues: string[];
  config: M067S02ConfigEvidence;
  scenarios: M067S02Scenario[];
  validation: {
    disabled: M067S02ValidationEvidence;
    applied: M067S02ValidationEvidence;
  };
};

type LoadConfigSummary = {
  enabled: boolean;
  warningCount: number;
};

type EvaluateM067S02Params = {
  generatedAt?: string;
  overrides?: {
    loadEnabledConfigFn?: () => Promise<LoadConfigSummary>;
    loadDefaultConfigFn?: () => Promise<LoadConfigSummary>;
    validationLlmResponse?: string;
  };
};

type VerifyM067S02Args = {
  help: boolean;
  json: boolean;
};

const ALLOWED_STATUSES = new Set<GraphValidationPlanStatus>([
  "enabled",
  "unavailable",
  "skipped",
  "applied",
]);

const RAW_LEAK_MARKERS = [
  "PROMPT_SECRET",
  "diff --git",
  "TOKEN=",
  "abc123",
  "super-secret",
  "rawPrompt",
  "rawDiff",
  "secretToken",
  "validation prompt",
];

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

async function loadInlineConfigFixture(contents: string | null): Promise<LoadConfigSummary> {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-m067-s02-"));
  try {
    if (contents !== null) {
      await Bun.write(join(dir, ".kodiai.yml"), contents);
    }
    const result = await loadRepoConfig(dir);
    return {
      enabled: result.config.review.graphValidation.enabled,
      warningCount: result.warnings.length,
    };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

function representativeReviewPlanInput(status: GraphValidationPlanStatus, reason: string | undefined): ReviewPlanInput {
  return {
    task: {
      taskType: "review.full",
      routingReason: "standard",
    },
    change: {
      changedFileCount: 4,
      linesChanged: 212,
      linesChangedSource: "local-diff",
    },
    budget: {
      timeoutSeconds: 900,
      maxTurns: 50,
      maxTurnsSource: "config",
    },
    context: {
      sources: ["diff-analysis", "review-boundedness"],
      summary: "Bounded inline verifier fixture; PROMPT_SECRET and diff markers must never render.",
    },
    gates: {
      enabled: ["review-routing", "timeout-estimation", "review-boundedness"],
      current: ["review-routing", "timeout-estimation", "review-boundedness"],
    },
    policy: {
      publish: "canonical-visible-surface",
      tools: "github-comment-tools",
      retry: "timeout-resilience",
    },
    graphValidation: {
      status,
      reason,
    },
    candidateFinding: {
      mode: "unavailable",
      reason: "candidate-finding-not-configured",
    },
  };
}

function countReviewPlanLines(value: string): number {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("Review plan:")).length;
}

function buildScenario(
  name: M067S02Scenario["name"],
  input: Parameters<typeof resolveGraphValidationPlanStatus>[0],
  expectedStatus: GraphValidationPlanStatus,
): M067S02Scenario {
  const projection = resolveGraphValidationPlanStatus(input);
  const plan = buildReviewPlan(representativeReviewPlanInput(projection.status, projection.reason)).plan;
  const details = toReviewPlanDetailsSummary(plan);

  return {
    name,
    expected_status: expectedStatus,
    actual_status: projection.status,
    reason: projection.reason,
    review_plan_line_count: countReviewPlanLines(details.text),
    review_plan_line: details.text,
    config_snapshot: {
      reviewPlan: {
        status: plan.status,
        hash: plan.hash,
        graphValidationStatus: plan.graphValidation.status,
      },
    },
  };
}

function hasRawLeak(value: string): boolean {
  return RAW_LEAK_MARKERS.some((marker) => value.includes(marker));
}

function summarizeValidation<T extends { id: string; filePath: string; title: string; severity: string }>(
  result: GraphValidationResult<T>,
): M067S02ValidationEvidence {
  return {
    succeeded: result.succeeded,
    validatedCount: result.validatedCount,
    confirmedCount: result.confirmedCount,
    uncertainCount: result.uncertainCount,
    verdicts: result.findings.map((finding) => finding.graphValidationVerdict),
    ...(result.errorMessage === undefined ? {} : { errorMessage: result.errorMessage }),
  };
}

function validationBlastRadiusFixture(): ReviewGraphBlastRadiusResult {
  return {
    changedFiles: ["src/direct.ts"],
    seedSymbols: [{
      stableKey: "symbol:src/direct.ts#direct",
      symbolName: "direct",
      qualifiedName: "direct",
      filePath: "src/direct.ts",
    }],
    impactedFiles: [
      {
        path: "src/indirect-confirmed.ts",
        score: 0.91,
        confidence: 0.87,
        reasons: ["imports changed module"],
        relatedChangedPaths: ["src/direct.ts"],
        languages: ["typescript"],
      },
      {
        path: "src/indirect-uncertain.ts",
        score: 0.71,
        confidence: 0.64,
        reasons: ["calls changed symbol"],
        relatedChangedPaths: ["src/direct.ts"],
        languages: ["typescript"],
      },
    ],
    probableDependents: [],
    likelyTests: [],
    graphStats: {
      files: 3,
      nodes: 4,
      edges: 3,
      changedFilesFound: 1,
    },
  };
}

function validationFindingsFixture() {
  return [
    {
      id: "confirmed-finding",
      filePath: "src/indirect-confirmed.ts",
      title: "PROMPT_SECRET graph-amplified confirmed fixture title",
      severity: "major",
    },
    {
      id: "uncertain-finding",
      filePath: "src/indirect-uncertain.ts",
      title: "diff --git graph-amplified uncertain fixture title TOKEN=super-secret",
      severity: "medium",
    },
    {
      id: "direct-finding",
      filePath: "src/direct.ts",
      title: "direct file finding is not graph-amplified",
      severity: "minor",
    },
  ];
}

async function buildValidationEvidence(llmResponse = "1: CONFIRMED\n2: UNCERTAIN"): Promise<M067S02Report["validation"]> {
  const disabledFindings = validationFindingsFixture().slice(0, 2);
  const disabled = await validateGraphAmplifiedFindings(
    disabledFindings,
    validationBlastRadiusFixture(),
    { generate: async () => llmResponse },
    { enabled: false, maxFindingsToValidate: 10 },
    silentLogger,
  );
  const applied = await validateGraphAmplifiedFindings(
    validationFindingsFixture(),
    validationBlastRadiusFixture(),
    { generate: async () => llmResponse },
    { enabled: true, maxFindingsToValidate: 10 },
    silentLogger,
  );

  return {
    disabled: summarizeValidation(disabled),
    applied: summarizeValidation(applied),
  };
}

function buildConfigReachabilityCheck(config: M067S02ConfigEvidence): M067S02Check {
  const failures = [
    ...(config.enabled_value !== true ? [`enabled fixture parsed ${String(config.enabled_value)}`] : []),
    ...(config.default_value !== false ? [`default fixture parsed ${String(config.default_value)}`] : []),
    ...(config.enabled_warning_count !== 0 ? [`enabled fixture emitted ${config.enabled_warning_count} warnings`] : []),
  ];

  return {
    id: "CONFIG-REACHABILITY",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "config_reachability_ok" : "config_reachability_failed",
    detail: failures.length === 0
      ? "review.graphValidation.enabled reaches typed config parsing with enabled=true and omitted=false"
      : failures.join("; "),
  };
}

function buildPlanDetailsStatesCheck(scenarios: M067S02Scenario[]): M067S02Check {
  const failures = scenarios.flatMap((scenario) => {
    const line = scenario.review_plan_line;
    const scenarioFailures = [];
    if (scenario.actual_status !== scenario.expected_status) {
      scenarioFailures.push(`${scenario.name} expected ${scenario.expected_status} got ${scenario.actual_status}`);
    }
    if (!ALLOWED_STATUSES.has(scenario.actual_status)) {
      scenarioFailures.push(`${scenario.name} emitted non-vocabulary status ${scenario.actual_status}`);
    }
    if (scenario.review_plan_line_count !== 1) {
      scenarioFailures.push(`${scenario.name} emitted ${scenario.review_plan_line_count} Review plan lines`);
    }
    if (!line.includes(`graph=${scenario.actual_status}`)) {
      scenarioFailures.push(`${scenario.name} Review Details omitted graph=${scenario.actual_status}`);
    }
    if (line.includes("disabled")) {
      scenarioFailures.push(`${scenario.name} Review Details leaked removed disabled status`);
    }
    if (line.length > 242) {
      scenarioFailures.push(`${scenario.name} Review Details line too long (${line.length} chars)`);
    }
    return scenarioFailures;
  });

  return {
    id: "PLAN-DETAILS-STATES",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "plan_details_states_ok" : "plan_details_states_failed",
    detail: failures.length === 0
      ? "ReviewPlan details expose exactly one bounded graph status line for skipped, unavailable, enabled, and applied"
      : failures.join("; "),
  };
}

function buildValidationSemanticsCheck(validation: M067S02Report["validation"]): M067S02Check {
  const failures = [
    ...(validation.disabled.succeeded !== true ? ["disabled validation did not succeed as fail-open skip"] : []),
    ...(validation.disabled.validatedCount !== 0 ? [`disabled validation counted ${validation.disabled.validatedCount} validated findings`] : []),
    ...(!validation.disabled.verdicts.every((verdict) => verdict === "skipped") ? ["disabled validation produced non-skipped verdicts"] : []),
    ...(validation.applied.succeeded !== true ? ["applied validation did not succeed"] : []),
    ...(validation.applied.validatedCount !== 2 ? [`applied validation validated ${validation.applied.validatedCount} findings`] : []),
    ...(validation.applied.confirmedCount !== 1 ? [`applied validation confirmed ${validation.applied.confirmedCount} findings`] : []),
    ...(validation.applied.uncertainCount !== 1 ? [`applied validation marked ${validation.applied.uncertainCount} uncertain findings`] : []),
    ...(validation.applied.verdicts.join(",") !== "confirmed,uncertain,skipped" ? [`applied validation verdicts were ${validation.applied.verdicts.join(",")}`] : []),
  ];

  return {
    id: "VALIDATION-SEMANTICS",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "validation_semantics_ok" : "validation_semantics_invalid",
    detail: failures.length === 0
      ? "graph validation skips cleanly when disabled and validates graph-amplified findings when enabled without blocking"
      : failures.join("; "),
  };
}

function buildNoRawLeaksCheck(reportParts: {
  config: M067S02ConfigEvidence;
  scenarios: M067S02Scenario[];
  validation: M067S02Report["validation"];
}): M067S02Check {
  const boundedEvidence = JSON.stringify(reportParts);
  const scenarioLeaks = reportParts.scenarios.flatMap((scenario) => (
    hasRawLeak(scenario.review_plan_line) ? [`${scenario.name} Review Details line leaked raw marker`] : []
  ));
  const serializedLeaks = hasRawLeak(boundedEvidence) ? ["report evidence leaked raw marker"] : [];
  const failures = [...scenarioLeaks, ...serializedLeaks];

  return {
    id: "NO-RAW-LEAKS",
    passed: failures.length === 0,
    status_code: failures.length === 0 ? "no_raw_leaks" : "raw_leaks_detected",
    detail: failures.length === 0
      ? "verifier evidence contains only bounded status/reason/count tokens and no raw fixture data"
      : failures.join("; "),
  };
}

function deriveOutcome(checks: M067S02Check[]): Pick<M067S02Report, "success" | "status_code" | "failing_check_id" | "issues"> {
  const failingCheck = checks.find((check) => !check.passed);
  if (!failingCheck) {
    return {
      success: true,
      status_code: "m067_s02_ok",
      failing_check_id: null,
      issues: [],
    };
  }

  return {
    success: false,
    status_code: "m067_s02_contract_failed",
    failing_check_id: failingCheck.id,
    issues: [`${failingCheck.id}: ${failingCheck.detail}`],
  };
}

function emptyConfigEvidence(): M067S02ConfigEvidence {
  return {
    enabled_value: false,
    default_value: false,
    enabled_warning_count: 0,
    default_warning_count: 0,
  };
}

function emptyValidationEvidence(): M067S02Report["validation"] {
  return {
    disabled: { succeeded: false, validatedCount: 0, confirmedCount: 0, uncertainCount: 0, verdicts: [] },
    applied: { succeeded: false, validatedCount: 0, confirmedCount: 0, uncertainCount: 0, verdicts: [] },
  };
}

function buildInvalidArgReport(params: { generatedAt?: string; issue: string }): M067S02Report {
  return {
    command: "verify:m067:s02",
    generated_at: params.generatedAt ?? new Date().toISOString(),
    success: false,
    status_code: "m067_s02_invalid_arg",
    check_ids: [...M067_S02_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    issues: [params.issue],
    config: emptyConfigEvidence(),
    scenarios: [],
    validation: emptyValidationEvidence(),
  };
}

export async function evaluateM067S02GraphValidationContract(params?: EvaluateM067S02Params): Promise<M067S02Report> {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const enabledConfig = await (params?.overrides?.loadEnabledConfigFn?.() ?? loadInlineConfigFixture([
    "review:",
    "  graphValidation:",
    "    enabled: true",
    "",
  ].join("\n")));
  const defaultConfig = await (params?.overrides?.loadDefaultConfigFn?.() ?? loadInlineConfigFixture(null));
  const config: M067S02ConfigEvidence = {
    enabled_value: enabledConfig.enabled,
    default_value: defaultConfig.enabled,
    enabled_warning_count: enabledConfig.warningCount,
    default_warning_count: defaultConfig.warningCount,
  };
  const scenarios = [
    buildScenario("default-disabled", { configEnabled: false }, "skipped"),
    buildScenario("enabled-no-query", { configEnabled: true, graphQueryAvailable: false }, "unavailable"),
    buildScenario("enabled-with-graph", {
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: true,
    }, "enabled"),
    buildScenario("final-applied", {
      configEnabled: true,
      graphQueryAvailable: true,
      graphBlastRadiusAvailable: true,
      finalValidationApplied: true,
    }, "applied"),
  ];
  const validation = await buildValidationEvidence(params?.overrides?.validationLlmResponse);
  const checks = [
    buildConfigReachabilityCheck(config),
    buildPlanDetailsStatesCheck(scenarios),
    buildValidationSemanticsCheck(validation),
    buildNoRawLeaksCheck({ config, scenarios, validation }),
  ];
  const outcome = deriveOutcome(checks);

  return {
    command: "verify:m067:s02",
    generated_at: generatedAt,
    success: outcome.success,
    status_code: outcome.status_code,
    check_ids: [...M067_S02_CHECK_IDS],
    checks,
    failing_check_id: outcome.failing_check_id,
    issues: outcome.issues,
    config,
    scenarios,
    validation,
  };
}

export function parseVerifyM067S02Args(args: string[]): VerifyM067S02Args {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h" || arg === "--json") {
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m067:s02 -- [--json]",
    "",
    "Verifies the M067 S02 graph-validation config, ReviewPlan projection, and validation semantics using local inline fixtures only.",
    "",
    "Options:",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM067S02Report(report: M067S02Report): string {
  const lines = [
    "# M067 S02 — Graph Validation Contract Verifier",
    "",
    `Status: ${report.status_code}`,
    `Overall success: ${String(report.success)}`,
    `Failing check: ${report.failing_check_id ?? "none"}`,
    `Config graphValidation: enabled=${String(report.config.enabled_value)} default=${String(report.config.default_value)}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status_code} (passed=${String(check.passed)})`);
    lines.push(`  - ${check.detail}`);
  }

  lines.push("", "Scenarios:");
  for (const scenario of report.scenarios) {
    lines.push(`- ${scenario.name}: ${scenario.actual_status} (${scenario.reason ?? "no-reason"})`);
  }

  lines.push("", "Validation:");
  lines.push(`- disabled: succeeded=${String(report.validation.disabled.succeeded)} validated=${report.validation.disabled.validatedCount}`);
  lines.push(`- applied: succeeded=${String(report.validation.applied.succeeded)} validated=${report.validation.applied.validatedCount} confirmed=${report.validation.applied.confirmedCount} uncertain=${report.validation.applied.uncertainCount}`);

  if (report.issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluateFn?: typeof evaluateM067S02GraphValidationContract;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const evaluateFn = deps?.evaluateFn ?? evaluateM067S02GraphValidationContract;

  try {
    const options = parseVerifyM067S02Args(args);

    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const report = await evaluateFn();
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM067S02Report(report));

    if (!report.success) {
      stderr.write(`verify:m067:s02 failed: ${report.failing_check_id ?? report.status_code}\n`);
    }

    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = buildInvalidArgReport({ issue: message });
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
