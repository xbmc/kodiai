import {
  classifyDocsConfigTruthTrigger,
  DOCS_CONFIG_TRUTH_LANE_ID,
  normalizeShadowSpecialistOutput,
  type NormalizedShadowSpecialistOutput,
  type ShadowSpecialistOutputInput,
  type ShadowSpecialistTriggerInput,
  type ShadowSpecialistTriggerResult,
} from "../src/specialists/shadow-specialist.ts";

export const COMMAND_NAME = "verify:m069:s01" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m069-s01.ts" as const;

export const M069_S01_CHECK_IDS = [
  "M069-S01-TRIGGER-CONTRACT",
  "M069-S01-SKIP-CONTRACT",
  "M069-S01-OUTPUT-METRICS-CONTRACT",
  "M069-S01-REDACTION-CONTRACT",
  "M069-S01-PACKAGE-WIRING",
] as const;

export type M069S01CheckId = (typeof M069_S01_CHECK_IDS)[number];
export type M069S01StatusCode = "m069_s01_ok" | "m069_s01_contract_failed" | "m069_s01_invalid_arg";
export type M069S01CheckStatus = "pass" | "fail";
export type M069S01CheckStatusCode =
  | "trigger_contract_ok"
  | "trigger_contract_failed"
  | "skip_contract_ok"
  | "skip_contract_failed"
  | "output_metrics_contract_ok"
  | "output_metrics_contract_failed"
  | "redaction_contract_ok"
  | "redaction_contract_failed"
  | "package_wiring_ok"
  | "package_wiring_failed";

export type M069S01Check = {
  readonly id: M069S01CheckId;
  readonly passed: boolean;
  readonly status: M069S01CheckStatus;
  readonly status_code: M069S01CheckStatusCode;
  readonly detail: string;
};

export type M069S01TriggerSummary = {
  readonly status: ShadowSpecialistTriggerResult["status"];
  readonly laneId: ShadowSpecialistTriggerResult["laneId"];
  readonly skipReason: ShadowSpecialistTriggerResult["skipReason"];
  readonly degradedReason: ShadowSpecialistTriggerResult["degradedReason"];
  readonly errorKind: ShadowSpecialistTriggerResult["errorKind"];
  readonly matchedPathCount: number;
  readonly candidateCount: number;
  readonly selectedLaneCount: number;
  readonly shadowOnly: true;
  readonly publishesFindings: false;
  readonly correlationKeyPresent: boolean;
};

export type M069S01OutputSummary = {
  readonly status: NormalizedShadowSpecialistOutput["status"];
  readonly laneId: NormalizedShadowSpecialistOutput["laneId"];
  readonly skipReason: NormalizedShadowSpecialistOutput["skipReason"];
  readonly degradedReasons: readonly string[];
  readonly errorKind: NormalizedShadowSpecialistOutput["errorKind"];
  readonly candidateCount: number;
  readonly truncatedCandidateCount: number;
  readonly decisionCounts: NormalizedShadowSpecialistOutput["decisionCounts"];
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly metrics: NormalizedShadowSpecialistOutput["metrics"];
  readonly deliveryIdPresent: boolean;
  readonly reviewOutputKeyPresent: boolean;
  readonly correlationKeyPresent: boolean;
  readonly redactionFlags: NormalizedShadowSpecialistOutput["redactionFlags"];
  readonly shadowOnly: true;
  readonly publishesFindings: false;
};

export type M069S01Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generated_at: string;
  readonly success: boolean;
  readonly status_code: M069S01StatusCode;
  readonly check_ids: readonly M069S01CheckId[];
  readonly checks: readonly M069S01Check[];
  readonly failing_check_id: M069S01CheckId | null;
  readonly trigger: M069S01TriggerSummary;
  readonly skip: M069S01TriggerSummary;
  readonly normalizedOutput: M069S01OutputSummary;
  readonly summary: {
    readonly triggeredLaneCount: number;
    readonly skippedLaneCount: number;
    readonly normalizedCandidateCount: number;
    readonly duplicateCount: number;
    readonly disagreementCount: number;
    readonly unsafeFieldCount: number;
    readonly truncatedCandidateCount: number;
    readonly tokenCountAvailable: boolean;
    readonly costAvailable: boolean;
    readonly latencyMsAvailable: boolean;
  };
  readonly issues: readonly string[];
};

export type M069S01Args = {
  readonly json: boolean;
  readonly help: boolean;
};

export type EvaluateM069S01Options = {
  readonly generatedAt?: string;
  readonly classifyTrigger?: (input: ShadowSpecialistTriggerInput) => ShadowSpecialistTriggerResult;
  readonly normalizeOutput?: (input: ShadowSpecialistOutputInput) => NormalizedShadowSpecialistOutput;
  readonly readPackageJsonText?: () => Promise<string>;
};

const TRIGGER_FIXTURE: ShadowSpecialistTriggerInput = {
  changedPaths: [
    "docs/operators/review-details.md",
    "scripts/verify-m069-s01.ts",
    "src/handlers/review.ts",
  ],
  correlationKey: "m069-s01-correlation",
};

const SKIP_FIXTURE: ShadowSpecialistTriggerInput = {
  changedPaths: [
    "src/handlers/review.ts",
    "src/specialists/shadow-specialist.test.ts",
    "bun.lock",
  ],
};

const OUTPUT_FIXTURE: ShadowSpecialistOutputInput = {
  status: "ok",
  deliveryId: "delivery-123",
  reviewOutputKey: "review-output-123",
  correlationKey: "m069-s01-correlation",
  prompt: "raw prompt",
  toolPayload: { secret: "tool output" },
  candidates: [
    { fingerprint: "candidate-a", decision: "candidate" },
    { fingerprint: "candidate-a", decision: "candidate" },
    {
      fingerprint: "candidate-c",
      decision: "disagreement",
      disagreementCategory: "operator-runbook-gap",
      commentBody: "GitHub-visible body",
      inlineComment: "publication shaped text",
      approved: true,
    },
  ],
  metrics: {
    tokenCount: 100,
    costUsd: 0.42,
    latencyMs: 1200,
  },
};

export function parseM069S01Args(args: readonly string[]): M069S01Args {
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json, help };
}

export async function evaluateM069S01Contract(options: EvaluateM069S01Options = {}): Promise<M069S01Report> {
  const classifyTriggerFn = options.classifyTrigger ?? classifyDocsConfigTruthTrigger;
  const normalizeOutputFn = options.normalizeOutput ?? normalizeShadowSpecialistOutput;
  const readPackageJsonText = options.readPackageJsonText ?? (() => Bun.file("package.json").text());

  const triggerResult = classifyTriggerFn(TRIGGER_FIXTURE);
  const skipResult = classifyTriggerFn(SKIP_FIXTURE);
  const normalizedOutput = normalizeOutputFn(OUTPUT_FIXTURE);
  const packageJsonText = await readPackageJsonText();

  const checks = [
    buildTriggerCheck(triggerResult),
    buildSkipCheck(skipResult),
    buildOutputMetricsCheck(normalizedOutput),
    buildRedactionCheck(normalizedOutput),
    buildPackageWiringCheck(packageJsonText),
  ];
  const issues = checks.filter((check) => !check.passed).map((check) => check.detail);
  const failingCheck = checks.find((check) => !check.passed) ?? null;

  return {
    command: COMMAND_NAME,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m069_s01_ok" : "m069_s01_contract_failed",
    check_ids: [...M069_S01_CHECK_IDS],
    checks,
    failing_check_id: failingCheck?.id ?? null,
    trigger: summarizeTrigger(triggerResult),
    skip: summarizeTrigger(skipResult),
    normalizedOutput: summarizeOutput(normalizedOutput),
    summary: {
      triggeredLaneCount: triggerResult.selectedLaneCount,
      skippedLaneCount: skipResult.selectedLaneCount,
      normalizedCandidateCount: normalizedOutput.candidateCount,
      duplicateCount: normalizedOutput.duplicateCount,
      disagreementCount: normalizedOutput.disagreementCount,
      unsafeFieldCount: normalizedOutput.redactionFlags.unsafeFieldCount,
      truncatedCandidateCount: normalizedOutput.truncatedCandidateCount,
      tokenCountAvailable: normalizedOutput.metrics.tokenCountAvailable,
      costAvailable: normalizedOutput.metrics.costAvailable,
      latencyMsAvailable: normalizedOutput.metrics.latencyMsAvailable,
    },
    issues,
  };
}

function buildTriggerCheck(result: ShadowSpecialistTriggerResult): M069S01Check {
  const failures: string[] = [];
  if (result.status !== "triggered") failures.push("Expected operator-truth fixture to trigger.");
  if (result.laneId !== DOCS_CONFIG_TRUTH_LANE_ID) failures.push("Expected docs-config-truth lane id.");
  if (result.selectedLaneCount !== 1) failures.push("Expected trigger to select exactly one shadow lane.");
  if (result.skipReason !== null) failures.push("Expected trigger skipReason to be null.");
  if (result.candidateCount !== 2 || result.matchedPaths.length !== 2) failures.push("Expected trigger to expose exactly two bounded matched-path candidates.");
  assertShadowOnly(result, failures);

  return makeCheck({
    id: "M069-S01-TRIGGER-CONTRACT",
    okCode: "trigger_contract_ok",
    failCode: "trigger_contract_failed",
    okDetail: "Operator docs/verifier paths trigger exactly one shadow-only docs-config-truth lane.",
    failures,
  });
}

function buildSkipCheck(result: ShadowSpecialistTriggerResult): M069S01Check {
  const failures: string[] = [];
  if (result.status !== "skipped") failures.push("Expected non-operator fixture to skip.");
  if (result.laneId !== null) failures.push("Expected skipped fixture laneId to be null.");
  if (result.skipReason !== "no-operator-truth-paths") failures.push("Expected bounded no-operator-truth-paths skip reason.");
  if (result.selectedLaneCount !== 0) failures.push("Expected skipped fixture to select zero lanes.");
  if (result.candidateCount !== 0 || result.matchedPaths.length !== 0) failures.push("Expected skipped fixture to expose zero candidates.");
  assertShadowOnly(result, failures);

  return makeCheck({
    id: "M069-S01-SKIP-CONTRACT",
    okCode: "skip_contract_ok",
    failCode: "skip_contract_failed",
    okDetail: "Unrelated source/test/dependency paths skip with bounded diagnostics and no selected lane.",
    failures,
  });
}

function buildOutputMetricsCheck(result: NormalizedShadowSpecialistOutput): M069S01Check {
  const failures: string[] = [];
  if (result.laneId !== DOCS_CONFIG_TRUTH_LANE_ID) failures.push("Expected normalized output lane id to be docs-config-truth.");
  if (result.status !== "degraded") failures.push("Expected unsafe synthetic output to normalize to degraded.");
  if (result.candidateCount !== 3) failures.push("Expected three bounded normalized candidates.");
  if (result.duplicateCount !== 1) failures.push("Expected duplicateCount to equal one.");
  if (result.disagreementCount !== 1) failures.push("Expected disagreementCount to equal one.");
  if (result.metrics.decisionCount !== 3) failures.push("Expected decision metric count to equal candidate count.");
  if (!result.metrics.tokenCountAvailable || !result.metrics.costAvailable || !result.metrics.latencyMsAvailable) {
    failures.push("Expected token, cost, and latency availability to be true for synthetic metrics.");
  }
  assertShadowOnly(result, failures);

  return makeCheck({
    id: "M069-S01-OUTPUT-METRICS-CONTRACT",
    okCode: "output_metrics_contract_ok",
    failCode: "output_metrics_contract_failed",
    okDetail: "Normalized output exposes bounded candidate, decision, duplicate, disagreement, token, cost, and latency metrics.",
    failures,
  });
}

function buildRedactionCheck(result: NormalizedShadowSpecialistOutput): M069S01Check {
  const failures: string[] = [];
  if (result.errorKind !== "unsafe-publication-field") failures.push("Expected unsafe publication fields to set unsafe-publication-field.");
  if (!result.degradedReasons.includes("unsafe-fields-discarded")) failures.push("Expected unsafe-fields-discarded degraded reason.");
  if (result.redactionFlags.unsafeFieldCount !== 5) failures.push("Expected exactly five unsafe synthetic fields to be counted.");
  if (!result.redactionFlags.discardedRawPayload) failures.push("Expected raw payload redaction flag.");
  if (!result.redactionFlags.discardedPublicationFields) failures.push("Expected publication redaction flag.");
  if (!result.redactionFlags.discardedApprovalFields) failures.push("Expected approval redaction flag.");
  assertShadowOnly(result, failures);

  return makeCheck({
    id: "M069-S01-REDACTION-CONTRACT",
    okCode: "redaction_contract_ok",
    failCode: "redaction_contract_failed",
    okDetail: "Raw prompt/tool payload and publication-looking fields are discarded into bounded redaction flags only.",
    failures,
  });
}

function buildPackageWiringCheck(packageJsonText: string): M069S01Check {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    failures.push("package.json must be parseable JSON.");
  }

  const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
  if (scripts[COMMAND_NAME] !== EXPECTED_PACKAGE_SCRIPT) {
    failures.push(`package.json scripts.${COMMAND_NAME} must equal ${EXPECTED_PACKAGE_SCRIPT}.`);
  }

  return makeCheck({
    id: "M069-S01-PACKAGE-WIRING",
    okCode: "package_wiring_ok",
    failCode: "package_wiring_failed",
    okDetail: "package.json exposes verify:m069:s01 as the local pure contract verifier.",
    failures,
  });
}

function makeCheck(params: {
  id: M069S01CheckId;
  okCode: M069S01CheckStatusCode;
  failCode: M069S01CheckStatusCode;
  okDetail: string;
  failures: readonly string[];
}): M069S01Check {
  const passed = params.failures.length === 0;
  return {
    id: params.id,
    passed,
    status: passed ? "pass" : "fail",
    status_code: passed ? params.okCode : params.failCode,
    detail: passed ? params.okDetail : params.failures.join(" "),
  };
}

function assertShadowOnly(value: { shadowOnly: true; publishesFindings: false }, failures: string[]): void {
  if (value.shadowOnly !== true) failures.push("Expected shadowOnly to remain true.");
  if (value.publishesFindings !== false) failures.push("Expected publishesFindings to remain false.");
}

function summarizeTrigger(result: ShadowSpecialistTriggerResult): M069S01TriggerSummary {
  return {
    status: result.status,
    laneId: result.laneId,
    skipReason: result.skipReason,
    degradedReason: result.degradedReason,
    errorKind: result.errorKind,
    matchedPathCount: result.matchedPaths.length,
    candidateCount: result.candidateCount,
    selectedLaneCount: result.selectedLaneCount,
    shadowOnly: result.shadowOnly,
    publishesFindings: result.publishesFindings,
    correlationKeyPresent: result.correlationKey !== null,
  };
}

function summarizeOutput(result: NormalizedShadowSpecialistOutput): M069S01OutputSummary {
  return {
    status: result.status,
    laneId: result.laneId,
    skipReason: result.skipReason,
    degradedReasons: result.degradedReasons,
    errorKind: result.errorKind,
    candidateCount: result.candidateCount,
    truncatedCandidateCount: result.truncatedCandidateCount,
    decisionCounts: result.decisionCounts,
    duplicateCount: result.duplicateCount,
    disagreementCount: result.disagreementCount,
    metrics: result.metrics,
    deliveryIdPresent: result.deliveryId !== null,
    reviewOutputKeyPresent: result.reviewOutputKey !== null,
    correlationKeyPresent: result.correlationKey !== null,
    redactionFlags: result.redactionFlags,
    shadowOnly: result.shadowOnly,
    publishesFindings: result.publishesFindings,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderM069S01Report(report: M069S01Report): string {
  return [
    "M069 S01 shadow specialist contract verifier",
    `status: ${report.status_code}`,
    `success: ${report.success ? "yes" : "no"}`,
    "",
    "checks:",
    ...report.checks.map((check) => `- [${check.passed ? "x" : " "}] ${check.id}: ${check.detail}`),
    ...(report.issues.length > 0 ? ["", "issues:", ...report.issues.map((issue) => `- ${issue}`)] : []),
    "",
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "M069 S01 shadow specialist contract verifier",
    "",
    "Usage:",
    "  bun run verify:m069:s01 [--json]",
    "",
    "Notes:",
    "  - Uses synthetic in-memory fixtures plus package.json wiring only.",
    "  - Does not read .gsd, .planning, .audits, .env, GitHub, Azure, or credentials.",
    "  - Emits bounded statuses and counts; no raw prompts, model output, tool payloads, secrets, or GitHub-visible findings.",
    "",
  ].join("\n");
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  io?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
    evaluate?: typeof evaluateM069S01Contract;
  },
): Promise<number> {
  const stdout = io?.stdout ?? process.stdout;
  const stderr = io?.stderr ?? process.stderr;
  const evaluate = io?.evaluate ?? evaluateM069S01Contract;

  let parsed: M069S01Args;
  try {
    parsed = parseM069S01Args(args);
  } catch (error) {
    const report = buildInvalidArgReport(error instanceof Error ? error.message : String(error));
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(renderHelp());
    return 0;
  }

  const report = await evaluate({ generatedAt: new Date().toISOString() });
  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM069S01Report(report));
  }

  if (!report.success) {
    stderr.write(`${COMMAND_NAME} failed: ${report.failing_check_id ?? "unknown"}\n`);
  }

  return report.success ? 0 : 1;
}

function buildInvalidArgReport(issue: string): M069S01Report {
  const emptyTrigger: M069S01TriggerSummary = {
    status: "skipped",
    laneId: null,
    skipReason: "no-changed-paths",
    degradedReason: null,
    errorKind: null,
    matchedPathCount: 0,
    candidateCount: 0,
    selectedLaneCount: 0,
    shadowOnly: true,
    publishesFindings: false,
    correlationKeyPresent: false,
  };
  const emptyOutput: M069S01OutputSummary = summarizeOutput(normalizeShadowSpecialistOutput({ status: "skipped", candidates: [] }));

  return {
    command: COMMAND_NAME,
    generated_at: new Date().toISOString(),
    success: false,
    status_code: "m069_s01_invalid_arg",
    check_ids: [...M069_S01_CHECK_IDS],
    checks: [],
    failing_check_id: null,
    trigger: emptyTrigger,
    skip: emptyTrigger,
    normalizedOutput: emptyOutput,
    summary: {
      triggeredLaneCount: 0,
      skippedLaneCount: 0,
      normalizedCandidateCount: 0,
      duplicateCount: 0,
      disagreementCount: 0,
      unsafeFieldCount: 0,
      truncatedCandidateCount: 0,
      tokenCountAvailable: false,
      costAvailable: false,
      latencyMsAvailable: false,
    },
    issues: [issue],
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
