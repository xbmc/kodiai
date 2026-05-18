import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMAND_NAME = "verify:m073:s06" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m073-s06-live-proof.json";

export const LIVE_PROOF_CHECK_IDS = [
  "fixture.shape",
  "upstream-evidence.present",
  "baseline-comparison.present",
  "token-reduction.met",
  "latency.acceptable",
  "visible-projection.compatible",
  "rollback.ready",
  "redaction.safe",
  "negative-cases.covered",
] as const;

export type LiveProofCheckId = typeof LIVE_PROOF_CHECK_IDS[number];
export type LiveProofCheckStatus = "pass" | "fail";
export type M073S06StatusCode =
  | "m073_s06_ok"
  | "m073_s06_live_proof_failed"
  | "m073_s06_invalid_json"
  | "m073_s06_fixture_read_failed"
  | "m073_s06_invalid_arg";

export type LiveProofCheck = {
  readonly id: LiveProofCheckId;
  readonly status: LiveProofCheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

export type LiveProofObservedTotals = {
  readonly upstreamEvidenceCount: number;
  readonly upstreamPassedCount: number;
  readonly runtimeExecutionCount: number;
  readonly baselineRuntimeTotalTokens: number;
  readonly liveRuntimeTotalTokens: number;
  readonly tokenReductionTokens: number;
  readonly tokenReductionPercent: number;
  readonly baselineDurationMs: number;
  readonly liveDurationMs: number;
  readonly maxAllowedLatencyMs: number;
  readonly visibleProjectionCount: number;
  readonly visibleScopedCount: number;
  readonly visibleFallbackCount: number;
  readonly rollbackControlCount: number;
  readonly negativeCaseCount: number;
};

export type M073S06Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly overallPassed: boolean;
  readonly statusCode: M073S06StatusCode;
  readonly failedCheckIds: readonly LiveProofCheckId[];
  readonly checks: readonly LiveProofCheck[];
  readonly observedTotals: LiveProofObservedTotals;
  readonly issues: readonly string[];
};

export type M073S06Args = {
  readonly fixturePath: string;
  readonly json: boolean;
  readonly help: boolean;
};

export type M073S06Writer = {
  readonly write: (chunk: string) => unknown;
};

export type M073S06MainOptions = {
  readonly stdout?: M073S06Writer;
  readonly stderr?: M073S06Writer;
  readonly evaluate?: (fixturePath: string) => Promise<M073S06Report>;
};

export type EvaluateM073S06Options = {
  readonly generatedAt?: string;
  readonly readFixtureText?: (fixturePath: string) => Promise<string>;
};

type LiveProofEvaluation = {
  readonly checks: readonly LiveProofCheck[];
  readonly totals: LiveProofObservedTotals;
};

type LiveProofFailure = {
  readonly checks: readonly LiveProofCheck[];
  readonly totals: LiveProofObservedTotals;
};

const HELP_TEXT = `Usage: bun scripts/verify-m073-s06.ts [--fixture <path>] [--json] [--help]\n\nVerifies the M073/S06 bounded live-proof and rollback fixture without performing live GitHub writes.\n\nOptions:\n  --fixture <path>  Local JSON fixture path (default: ${DEFAULT_FIXTURE_PATH})\n  --json            Emit machine-readable JSON only\n  --help, -h        Show this help\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_ISSUES = 20;
const MAX_STRING_LENGTH = 220;
const REQUIRED_UPSTREAM_KEYS = ["s01", "s02", "s03", "s04", "s05"] as const;
const FORBIDDEN_RAW_TEXT_KEYS = /(^|_)(rawPrompt|promptText|prompt|diff|diffHunk|hunk|patch|comment|commentBody|body|candidate|candidateText|candidatePayload|modelOutput|completion|content|text|includedText|trimmedText|sectionText|retrievalText|retrievalChunk|retrievalChunks|chunkText|checkpointText)$/i;
const FORBIDDEN_RAW_FINGERPRINT_KEYS = /(^|_)(fingerprint|rawFingerprint|fingerprintHash|promptHash|diffHash|cacheKey|cacheKeyHash|embedding|embeddingVector|vector|token|apiKey)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function parseM073S06Args(args: readonly string[]): M073S06Args {
  let fixturePath = DEFAULT_FIXTURE_PATH;
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--fixture") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("invalid_cli_args: --fixture requires a path value");
      }
      fixturePath = value;
      index += 1;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { fixturePath, json, help };
}

export async function evaluateM073S06Fixture(fixturePath = DEFAULT_FIXTURE_PATH, options: EvaluateM073S06Options = {}): Promise<M073S06Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readFixtureText = options.readFixtureText ?? ((path: string) => Bun.file(path).text());

  let fixtureText: string;
  try {
    fixtureText = await readFixtureText(resolveFixtureReadPath(fixturePath));
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s06_fixture_read_failed",
      checkId: "fixture.shape",
      message: "Fixture could not be read.",
      issues: ["Fixture path is missing or unreadable."],
    });
  }

  let fixture: unknown;
  try {
    fixture = JSON.parse(fixtureText);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s06_invalid_json",
      checkId: "fixture.shape",
      message: "Fixture JSON could not be parsed.",
      issues: ["Fixture must be valid JSON."],
    });
  }

  const evaluation = evaluateLiveProofFixture(fixture);
  const failedChecks = evaluation.checks.filter((check) => check.status === "fail");
  const issues = boundIssues(failedChecks.flatMap((check) => check.issues.length > 0 ? check.issues : [check.message]));

  return {
    command: COMMAND_NAME,
    generatedAt,
    fixturePath,
    overallPassed: failedChecks.length === 0,
    statusCode: failedChecks.length === 0 ? "m073_s06_ok" : "m073_s06_live_proof_failed",
    failedCheckIds: uniqueSorted(failedChecks.map((check) => check.id)),
    checks: evaluation.checks,
    observedTotals: evaluation.totals,
    issues,
  };
}

export function evaluateLiveProofFixture(fixture: unknown): LiveProofEvaluation {
  const proof = readMainProof(fixture);
  const checks: LiveProofCheck[] = [];

  const shapeIssues = validateShape(fixture);
  checks.push(shapeIssues.length === 0
    ? pass("fixture.shape", "Fixture has the required live-proof evidence shape.")
    : fail("fixture.shape", "Fixture shape is invalid.", shapeIssues));

  const upstreamIssues = validateUpstreamEvidence(proof);
  checks.push(upstreamIssues.length === 0
    ? pass("upstream-evidence.present", "S01-S05 upstream verifier evidence is present and passed.")
    : fail("upstream-evidence.present", "S01-S05 upstream verifier evidence is missing or failed.", upstreamIssues));

  const baselineIssues = validateBaselineComparison(proof);
  checks.push(baselineIssues.length === 0
    ? pass("baseline-comparison.present", "Baseline and live runtime comparison fields are present.")
    : fail("baseline-comparison.present", "Baseline and live runtime comparison fields are incomplete.", baselineIssues));

  const tokenIssues = validateTokenReduction(proof);
  checks.push(tokenIssues.length === 0
    ? pass("token-reduction.met", "Live proof shows reduced runtime tokens against baseline.")
    : fail("token-reduction.met", "Live proof does not show the required runtime token reduction.", tokenIssues));

  const latencyIssues = validateLatency(proof);
  checks.push(latencyIssues.length === 0
    ? pass("latency.acceptable", "Live proof latency is within the configured rollout ceiling.")
    : fail("latency.acceptable", "Live proof latency exceeds the configured rollout ceiling.", latencyIssues));

  const visibleIssues = validateVisibleProjection(proof);
  checks.push(visibleIssues.length === 0
    ? pass("visible-projection.compatible", "Visible disclosure remains compatible with the S05 bounded projection.")
    : fail("visible-projection.compatible", "Visible disclosure is missing or incompatible with S05 bounded projection.", visibleIssues));

  const rollbackIssues = validateRollback(proof);
  checks.push(rollbackIssues.length === 0
    ? pass("rollback.ready", "Rollback controls and operator path are present.")
    : fail("rollback.ready", "Rollback controls are incomplete.", rollbackIssues));

  const redactionIssues = validateRedaction(proof);
  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Live-proof evidence is bounded and text-free.")
    : fail("redaction.safe", "Live-proof evidence contains unsafe field names, values, or unbounded strings.", redactionIssues));

  const negativeIssues = validateNegativeCases(fixture);
  checks.push(negativeIssues.length === 0
    ? pass("negative-cases.covered", "Fixture includes bounded negative cases proving verifier failures.")
    : fail("negative-cases.covered", "Negative-case coverage is missing or inconsistent.", negativeIssues));

  return { checks, totals: buildObservedTotals(fixture, proof) };
}

export async function main(args = Bun.argv.slice(2), options: M073S06MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (chunk: string) => process.stdout.write(chunk) };
  const stderr = options.stderr ?? { write: (chunk: string) => process.stderr.write(chunk) };

  let parsed: M073S06Args;
  try {
    parsed = parseM073S06Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    const report = buildFailureReport({
      generatedAt: new Date().toISOString(),
      fixturePath: DEFAULT_FIXTURE_PATH,
      statusCode: "m073_s06_invalid_arg",
      checkId: "fixture.shape",
      message: "CLI arguments are invalid.",
      issues: [message],
    });
    writeReport(report, { json: args.includes("--json"), stdout, stderr });
    return 2;
  }

  if (parsed.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }

  const evaluate = options.evaluate ?? ((fixturePath: string) => evaluateM073S06Fixture(fixturePath));
  const report = await evaluate(parsed.fixturePath);
  writeReport(report, { json: parsed.json, stdout, stderr });
  return report.overallPassed ? 0 : 1;
}

function resolveFixtureReadPath(fixturePath: string): string {
  if (fixturePath !== DEFAULT_FIXTURE_PATH) return fixturePath;
  if (existsSync(fixturePath)) return fixturePath;
  return join(PROJECT_ROOT, fixturePath);
}

function validateShape(fixture: unknown): string[] {
  if (!isRecord(fixture)) return ["Fixture root must be an object."];
  const issues: string[] = [];
  if (!isRecord(fixture.liveProof)) issues.push("liveProof object is required.");
  if (fixture.negativeProofCases !== undefined && !Array.isArray(fixture.negativeProofCases)) issues.push("negativeProofCases must be an array when present.");
  return issues;
}

function validateUpstreamEvidence(proof: unknown): string[] {
  if (!isRecord(proof) || !isRecord(proof.upstreamEvidence)) return ["upstreamEvidence object is required."];
  const issues: string[] = [];
  for (const key of REQUIRED_UPSTREAM_KEYS) {
    const evidence = proof.upstreamEvidence[key];
    if (!isRecord(evidence)) {
      issues.push(`upstreamEvidence.${key} is required.`);
      continue;
    }
    if (evidence.overallPassed !== true) issues.push(`upstreamEvidence.${key}.overallPassed must be true.`);
    if (typeof evidence.statusCode !== "string" || !evidence.statusCode.endsWith("_ok")) issues.push(`upstreamEvidence.${key}.statusCode must be an ok code.`);
    if (!Array.isArray(evidence.failedCheckIds) || evidence.failedCheckIds.length !== 0) issues.push(`upstreamEvidence.${key}.failedCheckIds must be empty.`);
  }
  return issues;
}

function validateBaselineComparison(proof: unknown): string[] {
  if (!isRecord(proof) || !isRecord(proof.baselineComparison)) return ["baselineComparison object is required."];
  const comparison = proof.baselineComparison;
  const issues: string[] = [];
  for (const key of ["baselineRuntimeTotalTokens", "liveRuntimeTotalTokens", "tokenReductionPercent", "baselineDurationMs", "liveDurationMs", "maxAllowedLatencyMs"] as const) {
    if (!isFiniteNumber(comparison[key])) issues.push(`baselineComparison.${key} must be a finite number.`);
  }
  if (!Array.isArray(proof.runtimeRows) || proof.runtimeRows.length === 0) issues.push("runtimeRows must include at least one bounded runtime row.");
  return issues;
}

function validateTokenReduction(proof: unknown): string[] {
  const comparison = readComparison(proof);
  if (!comparison) return ["baselineComparison is unavailable."];
  const baseline = numberValue(comparison.baselineRuntimeTotalTokens);
  const live = numberValue(comparison.liveRuntimeTotalTokens);
  const reductionPercent = numberValue(comparison.tokenReductionPercent);
  const minimumReductionPercent = numberValue(comparison.minimumReductionPercent, 20);
  const expectedPercent = baseline > 0 ? ((baseline - live) / baseline) * 100 : 0;
  const issues: string[] = [];
  if (baseline <= 0) issues.push("baselineRuntimeTotalTokens must be positive.");
  if (live <= 0) issues.push("liveRuntimeTotalTokens must be positive.");
  if (live >= baseline) issues.push("liveRuntimeTotalTokens must be lower than baselineRuntimeTotalTokens.");
  if (reductionPercent + 0.001 < minimumReductionPercent) issues.push(`tokenReductionPercent must be at least ${minimumReductionPercent}.`);
  if (Math.abs(reductionPercent - expectedPercent) > 0.01) issues.push("tokenReductionPercent must match baseline/live token totals.");
  return issues;
}

function validateLatency(proof: unknown): string[] {
  const comparison = readComparison(proof);
  if (!comparison) return ["baselineComparison is unavailable."];
  const liveDurationMs = numberValue(comparison.liveDurationMs);
  const maxAllowedLatencyMs = numberValue(comparison.maxAllowedLatencyMs);
  const issues: string[] = [];
  if (liveDurationMs <= 0) issues.push("liveDurationMs must be positive.");
  if (maxAllowedLatencyMs <= 0) issues.push("maxAllowedLatencyMs must be positive.");
  if (liveDurationMs > maxAllowedLatencyMs) issues.push("liveDurationMs exceeds maxAllowedLatencyMs.");
  return issues;
}

function validateVisibleProjection(proof: unknown): string[] {
  if (!isRecord(proof) || !isRecord(proof.visibleDisclosure)) return ["visibleDisclosure object is required."];
  const visible = proof.visibleDisclosure;
  const issues: string[] = [];
  if (visible.reviewDetailsVisible !== true) issues.push("visibleDisclosure.reviewDetailsVisible must be true.");
  if (visible.projectionCompatible !== true) issues.push("visibleDisclosure.projectionCompatible must be true.");
  if (visible.rawPayloadPublished !== false) issues.push("visibleDisclosure.rawPayloadPublished must be false.");
  if (!isRecord(visible.statusCounts) || numberValue(visible.statusCounts.scoped) < 1 || numberValue(visible.statusCounts.fallback) < 1) {
    issues.push("visibleDisclosure.statusCounts must include scoped and fallback coverage.");
  }
  if (!isRecord(visible.reasonCounts) || numberValue(visible.reasonCounts["prompt-budget-limited"]) < 1 || numberValue(visible.reasonCounts["continuation-fallback"]) < 1) {
    issues.push("visibleDisclosure.reasonCounts must include prompt-budget-limited and continuation-fallback coverage.");
  }
  return issues;
}

function validateRollback(proof: unknown): string[] {
  if (!isRecord(proof) || !isRecord(proof.rollback)) return ["rollback object is required."];
  const rollback = proof.rollback;
  const issues: string[] = [];
  if (rollback.tested !== true) issues.push("rollback.tested must be true.");
  if (rollback.lastKnownSafeMode !== "legacy-full-context") issues.push("rollback.lastKnownSafeMode must be legacy-full-context.");
  if (!Array.isArray(rollback.controls) || rollback.controls.length < 2) {
    issues.push("rollback.controls must include at least two rollback controls.");
  } else {
    for (const [index, control] of rollback.controls.entries()) {
      if (!isRecord(control)) {
        issues.push(`rollback.controls[${index}] must be an object.`);
        continue;
      }
      if (typeof control.name !== "string" || control.name.length === 0) issues.push(`rollback.controls[${index}].name is required.`);
      if (typeof control.disableValue !== "string" || control.disableValue.length === 0) issues.push(`rollback.controls[${index}].disableValue is required.`);
      if (control.verified !== true) issues.push(`rollback.controls[${index}].verified must be true.`);
    }
  }
  return issues;
}

function validateRedaction(value: unknown): string[] {
  return scanRedaction(value).slice(0, MAX_ISSUES);
}

function validateNegativeCases(fixture: unknown): string[] {
  if (!isRecord(fixture)) return ["Fixture root must be an object."];
  const cases = fixture.negativeProofCases;
  if (!Array.isArray(cases) || cases.length < 3) return ["negativeProofCases must include at least three failing examples."];
  const issues: string[] = [];
  const covered = new Set<LiveProofCheckId>();
  for (const [index, negativeCase] of cases.entries()) {
    if (!isRecord(negativeCase) || !Array.isArray(negativeCase.expectedFailedCheckIds) || !isRecord(negativeCase.liveProof)) {
      issues.push(`negativeProofCases[${index}] must include liveProof and expectedFailedCheckIds.`);
      continue;
    }
    const expected = negativeCase.expectedFailedCheckIds.filter(isLiveProofCheckId);
    const failed = evaluateLiveProofWithoutNegativeCases(negativeCase.liveProof).checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id);
    for (const expectedId of expected) {
      covered.add(expectedId);
      if (!failed.includes(expectedId)) issues.push(`negativeProofCases[${index}] did not fail expected check ${expectedId}.`);
    }
  }
  for (const required of ["token-reduction.met", "latency.acceptable", "rollback.ready", "redaction.safe"] as const) {
    if (!covered.has(required)) issues.push(`negativeProofCases must cover ${required}.`);
  }
  return issues;
}

function evaluateLiveProofWithoutNegativeCases(proof: unknown): LiveProofFailure {
  const checks = [
    validateShape({ liveProof: proof }).length === 0 ? pass("fixture.shape", "Fixture has the required live-proof evidence shape.") : fail("fixture.shape", "Fixture shape is invalid.", validateShape({ liveProof: proof })),
    validateUpstreamEvidence(proof).length === 0 ? pass("upstream-evidence.present", "S01-S05 upstream verifier evidence is present and passed.") : fail("upstream-evidence.present", "S01-S05 upstream verifier evidence is missing or failed.", validateUpstreamEvidence(proof)),
    validateBaselineComparison(proof).length === 0 ? pass("baseline-comparison.present", "Baseline and live runtime comparison fields are present.") : fail("baseline-comparison.present", "Baseline and live runtime comparison fields are incomplete.", validateBaselineComparison(proof)),
    validateTokenReduction(proof).length === 0 ? pass("token-reduction.met", "Live proof shows reduced runtime tokens against baseline.") : fail("token-reduction.met", "Live proof does not show the required runtime token reduction.", validateTokenReduction(proof)),
    validateLatency(proof).length === 0 ? pass("latency.acceptable", "Live proof latency is within the configured rollout ceiling.") : fail("latency.acceptable", "Live proof latency exceeds the configured rollout ceiling.", validateLatency(proof)),
    validateVisibleProjection(proof).length === 0 ? pass("visible-projection.compatible", "Visible disclosure remains compatible with the S05 bounded projection.") : fail("visible-projection.compatible", "Visible disclosure is missing or incompatible with S05 bounded projection.", validateVisibleProjection(proof)),
    validateRollback(proof).length === 0 ? pass("rollback.ready", "Rollback controls and operator path are present.") : fail("rollback.ready", "Rollback controls are incomplete.", validateRollback(proof)),
    validateRedaction(proof).length === 0 ? pass("redaction.safe", "Live-proof evidence is bounded and text-free.") : fail("redaction.safe", "Live-proof evidence contains unsafe field names, values, or unbounded strings.", validateRedaction(proof)),
  ];
  return { checks, totals: buildObservedTotals({ liveProof: proof }, proof) };
}

function buildObservedTotals(fixture: unknown, proof: unknown): LiveProofObservedTotals {
  const upstreamEvidence = isRecord(proof) && isRecord(proof.upstreamEvidence) ? proof.upstreamEvidence : {};
  const comparison = readComparison(proof);
  const visible = isRecord(proof) && isRecord(proof.visibleDisclosure) ? proof.visibleDisclosure : {};
  const rollback = isRecord(proof) && isRecord(proof.rollback) ? proof.rollback : {};
  const baselineRuntimeTotalTokens = comparison ? numberValue(comparison.baselineRuntimeTotalTokens) : 0;
  const liveRuntimeTotalTokens = comparison ? numberValue(comparison.liveRuntimeTotalTokens) : 0;
  const liveDurationMs = comparison ? numberValue(comparison.liveDurationMs) : 0;
  const baselineDurationMs = comparison ? numberValue(comparison.baselineDurationMs) : 0;
  const maxAllowedLatencyMs = comparison ? numberValue(comparison.maxAllowedLatencyMs) : 0;
  return {
    upstreamEvidenceCount: REQUIRED_UPSTREAM_KEYS.filter((key) => isRecord(upstreamEvidence[key])).length,
    upstreamPassedCount: REQUIRED_UPSTREAM_KEYS.filter((key) => isRecord(upstreamEvidence[key]) && upstreamEvidence[key].overallPassed === true).length,
    runtimeExecutionCount: isRecord(proof) && Array.isArray(proof.runtimeRows) ? proof.runtimeRows.length : 0,
    baselineRuntimeTotalTokens,
    liveRuntimeTotalTokens,
    tokenReductionTokens: Math.max(0, baselineRuntimeTotalTokens - liveRuntimeTotalTokens),
    tokenReductionPercent: comparison ? round2(numberValue(comparison.tokenReductionPercent)) : 0,
    baselineDurationMs,
    liveDurationMs,
    maxAllowedLatencyMs,
    visibleProjectionCount: numberValue(visible.projectionCount),
    visibleScopedCount: isRecord(visible.statusCounts) ? numberValue(visible.statusCounts.scoped) : 0,
    visibleFallbackCount: isRecord(visible.statusCounts) ? numberValue(visible.statusCounts.fallback) : 0,
    rollbackControlCount: Array.isArray(rollback.controls) ? rollback.controls.length : 0,
    negativeCaseCount: isRecord(fixture) && Array.isArray(fixture.negativeProofCases) ? fixture.negativeProofCases.length : 0,
  };
}

function scanRedaction(value: unknown, path = "$", issues: string[] = []): string[] {
  if (issues.length >= MAX_ISSUES) return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanRedaction(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (!isRecord(value)) {
    if (typeof value === "string") {
      if (value.length > MAX_STRING_LENGTH) issues.push(`${path} string exceeds bounded length.`);
      if (SECRET_LIKE_VALUE.test(value)) issues.push(`${path} contains a secret-like value.`);
    }
    return issues;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_TEXT_KEYS.test(key) || FORBIDDEN_RAW_FINGERPRINT_KEYS.test(key)) issues.push(`${nestedPath} uses a forbidden raw payload field name.`);
    scanRedaction(nested, nestedPath, issues);
  }
  return issues;
}

function buildFailureReport(params: {
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly statusCode: M073S06StatusCode;
  readonly checkId: LiveProofCheckId;
  readonly message: string;
  readonly issues: readonly string[];
}): M073S06Report {
  const check = fail(params.checkId, params.message, params.issues);
  return {
    command: COMMAND_NAME,
    generatedAt: params.generatedAt,
    fixturePath: params.fixturePath,
    overallPassed: false,
    statusCode: params.statusCode,
    failedCheckIds: [params.checkId],
    checks: [check],
    observedTotals: emptyObservedTotals(),
    issues: check.issues,
  };
}

function writeReport(report: M073S06Report, options: {
  readonly json: boolean;
  readonly stdout: M073S06Writer;
  readonly stderr: M073S06Writer;
}): void {
  if (options.json) {
    options.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [
    `${report.command}: ${report.overallPassed ? "PASS" : "FAIL"}`,
    `fixture: ${report.fixturePath}`,
    `statusCode: ${report.statusCode}`,
    `failedCheckIds: ${report.failedCheckIds.length > 0 ? report.failedCheckIds.join(",") : "none"}`,
    `upstreamPassed: ${report.observedTotals.upstreamPassedCount}/${report.observedTotals.upstreamEvidenceCount}`,
    `baselineTokens: ${report.observedTotals.baselineRuntimeTotalTokens}`,
    `liveTokens: ${report.observedTotals.liveRuntimeTotalTokens}`,
    `tokenReductionPercent: ${report.observedTotals.tokenReductionPercent}`,
    `liveDurationMs: ${report.observedTotals.liveDurationMs}`,
    `maxAllowedLatencyMs: ${report.observedTotals.maxAllowedLatencyMs}`,
    `rollbackControls: ${report.observedTotals.rollbackControlCount}`,
    `negativeCases: ${report.observedTotals.negativeCaseCount}`,
  ];
  if (!report.overallPassed && report.issues.length > 0) {
    lines.push("issues:", ...report.issues.map((issue) => `- ${issue}`));
  }
  const stream = report.overallPassed ? options.stdout : options.stderr;
  stream.write(`${lines.join("\n")}\n`);
}

function readMainProof(fixture: unknown): unknown {
  return isRecord(fixture) ? fixture.liveProof : undefined;
}

function readComparison(proof: unknown): Record<string, unknown> | undefined {
  return isRecord(proof) && isRecord(proof.baselineComparison) ? proof.baselineComparison : undefined;
}

function emptyObservedTotals(): LiveProofObservedTotals {
  return {
    upstreamEvidenceCount: 0,
    upstreamPassedCount: 0,
    runtimeExecutionCount: 0,
    baselineRuntimeTotalTokens: 0,
    liveRuntimeTotalTokens: 0,
    tokenReductionTokens: 0,
    tokenReductionPercent: 0,
    baselineDurationMs: 0,
    liveDurationMs: 0,
    maxAllowedLatencyMs: 0,
    visibleProjectionCount: 0,
    visibleScopedCount: 0,
    visibleFallbackCount: 0,
    rollbackControlCount: 0,
    negativeCaseCount: 0,
  };
}

function pass(id: LiveProofCheckId, message: string): LiveProofCheck {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: LiveProofCheckId, message: string, issues: readonly string[]): LiveProofCheck {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}

function boundIssues(issues: readonly string[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function isLiveProofCheckId(value: unknown): value is LiveProofCheckId {
  return typeof value === "string" && (LIVE_PROOF_CHECK_IDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberValue(value: unknown, fallback = 0): number {
  return isFiniteNumber(value) ? value : fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
