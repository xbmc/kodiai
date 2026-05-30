import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMAND_NAME = "verify:m075:s05" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s05.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m075-s05-review-timeout-classification.json" as const;

export type M075S05StatusCode =
  | "m075_s05_ok"
  | "m075_s05_contract_failed"
  | "m075_s05_fixture_read_failed"
  | "m075_s05_invalid_json"
  | "m075_s05_malformed_evidence"
  | "m075_s05_invalid_arg";
export type M075S05CheckStatus = "pass" | "fail";
export type M075S05CheckId =
  | "fixture.shape"
  | "mode-coverage.present"
  | "reason-codes.safe"
  | "runtime-signals.present"
  | "telemetry-taxonomy.present"
  | "redaction.safe"
  | "output.bounded"
  | "negative-controls.present"
  | "package-wiring.present";
export type M075S05Classification = "expected-bounded-outcome" | "hard-failure" | "unknown";
export type M075S05Mode =
  | "bounded-partial-timeout"
  | "zero-evidence-hard-timeout"
  | "max-turns-continuation"
  | "chronic-timeout-skip"
  | "retry-enqueued"
  | "retry-completed"
  | "retry-failed"
  | "long-run-threshold-exceeded"
  | "unknown-malformed-evidence";
export type M075S05Args = { readonly json: boolean; readonly help: boolean; readonly fixturePath?: string };
export type M075S05Check = { readonly id: M075S05CheckId; readonly status: M075S05CheckStatus; readonly message: string; readonly issues: readonly string[] };
export type M075S05Counts = Record<string, number | boolean | string | null | undefined>;
export type M075S05Scenario = {
  readonly name: string;
  readonly runtime: {
    readonly gate: "review-timeout-classification";
    readonly classification: M075S05Classification;
    readonly gateResult: M075S05Classification;
    readonly mode: M075S05Mode;
    readonly reasonCodes: readonly string[];
    readonly counts: M075S05Counts;
    readonly redaction: Record<string, boolean>;
    readonly deliveryId: string;
    readonly reviewOutputKey: string;
  };
  readonly log: Record<string, unknown>;
  readonly telemetry: Record<string, unknown>;
  readonly taxonomy: { readonly classId: string; readonly actionable: boolean };
};
export type M075S05EvidenceSnapshot = {
  readonly schema: "m075-s05-review-timeout-classification.v1";
  readonly generatedAt: string;
  readonly scenarios: readonly M075S05Scenario[];
  readonly negativeControls: Record<string, boolean>;
};
export type M075S05Observed = { readonly scenarioCount: number; readonly modeCount: number; readonly expectedBoundedCount: number; readonly hardFailureCount: number; readonly actionableCount: number };
export type M075S05Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M075S05StatusCode;
  readonly fixturePath?: string;
  readonly failedCheckIds: readonly M075S05CheckId[];
  readonly checks: readonly M075S05Check[];
  readonly observed: M075S05Observed;
  readonly issues: readonly string[];
};
export type EvaluateM075S05Options = {
  readonly generatedAt?: string;
  readonly readFileText?: (path: string) => Promise<string>;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly readTaxonomyText?: () => Promise<string>;
};
export type M075S05Writer = { readonly write: (chunk: string) => unknown };
export type M075S05MainOptions = { readonly stdout?: M075S05Writer; readonly stderr?: M075S05Writer; readonly evaluate?: (args: M075S05Args) => Promise<M075S05Report> };

const HELP_TEXT = `Usage: bun scripts/verify-m075-s05.ts [--fixture <path>] [--json] [--help]\n\nVerifies fixture-only review timeout classification evidence for M075/S05. Live mode is intentionally unsupported; the verifier reads one bounded JSON fixture and checks mode coverage, safe reason codes, structured runtime/log/telemetry/taxonomy mapping, redaction, negative controls, and package wiring.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_FIXTURE_BYTES = 100_000;
const MAX_ISSUES = 24;
const MAX_SCENARIOS = 16;
const MAX_REASON_CODES = 8;
const MAX_REASON_LENGTH = 80;
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const REQUIRED_MODES = ["bounded-partial-timeout", "zero-evidence-hard-timeout", "max-turns-continuation", "chronic-timeout-skip", "retry-enqueued", "retry-completed", "retry-failed", "long-run-threshold-exceeded"] as const satisfies readonly M075S05Mode[];
const REQUIRED_NEGATIVE_CONTROLS = ["invalidJsonRejected", "missingFixtureRejected", "ignoredPathRejected", "rawCanariesRejected", "unsafeReasonCodesRejected", "emptyReasonsRejected", "unboundedArraysRejected", "boundedSuccessNotHardFailure"] as const;
const SAFE_REASON = /^[a-z0-9][a-z0-9-]{1,79}$/;
const SAFE_REVIEW_OUTPUT_KEY = /^[A-Za-z0-9_.:/@-]{8,240}$/;
const FORBIDDEN_RAW_KEY = /(^|_)(raw(Log|Payload|Prompt|Model|Diff)|raw_log|raw_payload|prompt|modelOutput|candidateBody|candidatePayload|diff|patch|hunk|githubResponsePayload|secret|token|apiKey|password)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|PROMPT_SECRET|TOKEN=|diff --git|sk-[a-z0-9]|ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const EMPTY_OBSERVED: M075S05Observed = { scenarioCount: 0, modeCount: 0, expectedBoundedCount: 0, hardFailureCount: 0, actionableCount: 0 };

export function parseM075S05Args(args: readonly string[]): M075S05Args {
  const parsed: Partial<M075S05Args> = { json: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") { parsed.json = true; continue; }
    if (arg === "--help" || arg === "-h") { parsed.help = true; continue; }
    if (arg === "--fixture") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("invalid_cli_args: --fixture requires a value");
      assertSafeFixturePath(value);
      parsed.fixturePath = value;
      index += 1;
      continue;
    }
    if (arg === "--live") throw new Error("invalid_cli_args: verify:m075:s05 is fixture-only; live mode is intentionally unsupported");
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return parsed as M075S05Args;
}

export async function evaluateM075S05Contract(args: M075S05Args = parseM075S05Args(["--fixture", DEFAULT_FIXTURE_PATH]), options: EvaluateM075S05Options = {}): Promise<M075S05Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const taxonomyText = await (options.readTaxonomyText ?? (() => Bun.file("src/review-audit/production-log-taxonomy.ts").text()))().catch(() => "");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageText));
  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  let text: string;
  try {
    text = await (options.readFileText ?? ((path) => Bun.file(resolveFixtureReadPath(path)).text()))(fixturePath);
  } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s05_fixture_read_failed", [fail("fixture.shape", "Fixture could not be read.", ["Fixture path is missing or unreadable."]), packageCheck]);
  }
  if (text.length > MAX_FIXTURE_BYTES) {
    return reportFailure(generatedAt, fixturePath, "m075_s05_malformed_evidence", [fail("fixture.shape", "Fixture is larger than the verifier cap.", [`fixture bytes ${text.length} exceeds ${MAX_FIXTURE_BYTES}.`]), packageCheck]);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s05_invalid_json", [fail("fixture.shape", "Fixture JSON could not be parsed.", ["Fixture JSON could not be parsed."]), packageCheck]);
  }
  const snapshot = normalizeEvidenceSnapshot(parsed);
  if (!snapshot) {
    return reportFailure(generatedAt, fixturePath, "m075_s05_malformed_evidence", [fail("fixture.shape", "Evidence shape is malformed.", ["schema/generatedAt/scenarios/negativeControls shape is missing or invalid."]), packageCheck]);
  }
  const evaluation = evaluateEvidence(snapshot, packageCheck, taxonomyText);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s05_ok" : "m075_s05_contract_failed",
    fixturePath,
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))),
  };
}

export function evaluateEvidence(snapshot: M075S05EvidenceSnapshot, packageCheck: M075S05Check = packageWiringCheck(true), taxonomyText = ""): { readonly checks: readonly M075S05Check[]; readonly observed: M075S05Observed } {
  const modes = new Set(snapshot.scenarios.map((scenario) => scenario.runtime.mode));
  const observed: M075S05Observed = {
    scenarioCount: snapshot.scenarios.length,
    modeCount: modes.size,
    expectedBoundedCount: snapshot.scenarios.filter((scenario) => scenario.runtime.classification === "expected-bounded-outcome").length,
    hardFailureCount: snapshot.scenarios.filter((scenario) => scenario.runtime.classification === "hard-failure").length,
    actionableCount: snapshot.scenarios.filter((scenario) => scenario.taxonomy.actionable).length,
  };
  const checks: M075S05Check[] = [pass("fixture.shape", "Evidence has the bounded S05 review timeout classification shape.")];

  const coverageIssues = REQUIRED_MODES.filter((mode) => !modes.has(mode)).map((mode) => `mode ${mode} is missing.`);
  checks.push(coverageIssues.length === 0 ? pass("mode-coverage.present", "Fixture covers bounded partial, zero-evidence hard failure, max-turns, chronic skip, retry states, and long-run threshold modes.") : fail("mode-coverage.present", "Required timeout classification modes are missing.", coverageIssues));

  const reasonIssues = validateReasonCodes(snapshot);
  checks.push(reasonIssues.length === 0 ? pass("reason-codes.safe", "Every scenario has non-empty safe bounded reason codes.") : fail("reason-codes.safe", "Reason code evidence is empty, unsafe, or unbounded.", reasonIssues));

  const runtimeIssues = validateRuntimeSignals(snapshot);
  checks.push(runtimeIssues.length === 0 ? pass("runtime-signals.present", "Runtime and structured log evidence expose gate, classification, mode, reason codes, bounded counts, and correlation keys.") : fail("runtime-signals.present", "Runtime/log evidence is missing required safe fields.", runtimeIssues));

  const telemetryTaxonomyIssues = validateTelemetryTaxonomy(snapshot, taxonomyText);
  checks.push(telemetryTaxonomyIssues.length === 0 ? pass("telemetry-taxonomy.present", "Telemetry rows and production taxonomy distinguish expected bounded outcomes from hard failures and long-run threshold regressions.") : fail("telemetry-taxonomy.present", "Telemetry or taxonomy mapping is incomplete.", telemetryTaxonomyIssues));

  const redactionIssues = validateRedaction(snapshot);
  checks.push(redactionIssues.length === 0 ? pass("redaction.safe", "Fixture excludes raw prompts, model output, candidate bodies, diffs, GitHub payloads, raw logs, and secrets.") : fail("redaction.safe", "Unsafe raw evidence reached the verifier surface.", redactionIssues));

  const boundIssuesFound = validateBounds(snapshot);
  checks.push(boundIssuesFound.length === 0 ? pass("output.bounded", "Fixture scenarios, reason arrays, counts, and issue output remain bounded.") : fail("output.bounded", "Verifier-visible output exceeded bounds.", boundIssuesFound));

  const negativeIssues = validateNegativeControls(snapshot);
  checks.push(negativeIssues.length === 0 ? pass("negative-controls.present", "Fixture declares negative controls for malformed fixtures, missing modes, unsafe evidence, unbounded arrays, and bounded-success misclassification.") : fail("negative-controls.present", "Required negative controls are absent.", negativeIssues));

  checks.push(packageCheck);
  return { checks, observed };
}

function normalizeEvidenceSnapshot(value: unknown): M075S05EvidenceSnapshot | null {
  if (!isRecord(value) || value.schema !== "m075-s05-review-timeout-classification.v1" || typeof value.generatedAt !== "string") return null;
  if (!Array.isArray(value.scenarios) || !isRecord(value.negativeControls)) return null;
  for (const scenario of value.scenarios) {
    if (!isRecord(scenario) || typeof scenario.name !== "string" || !isRecord(scenario.runtime) || !isRecord(scenario.log) || !isRecord(scenario.telemetry) || !isRecord(scenario.taxonomy)) return null;
    if (scenario.runtime.gate !== "review-timeout-classification" || scenario.log.gate !== "review-timeout-classification") return null;
    if (!Array.isArray(scenario.runtime.reasonCodes) || !isRecord(scenario.runtime.counts) || !isRecord(scenario.runtime.redaction)) return null;
  }
  return value as M075S05EvidenceSnapshot;
}

function validateReasonCodes(snapshot: M075S05EvidenceSnapshot): string[] {
  const issues: string[] = [];
  snapshot.scenarios.forEach((scenario, index) => {
    const reasons = scenario.runtime.reasonCodes.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).map((reason) => reason.trim());
    if (reasons.length === 0) issues.push(`scenarios[${index}].runtime.reasonCodes must be non-empty.`);
    if (reasons.length > MAX_REASON_CODES) issues.push(`scenarios[${index}].runtime.reasonCodes exceeds ${MAX_REASON_CODES}.`);
    for (const reason of reasons) {
      if (reason.length > MAX_REASON_LENGTH || !SAFE_REASON.test(reason) || FORBIDDEN_RAW_VALUE.test(reason)) issues.push(`scenarios[${index}].runtime.reasonCodes contains unsafe reason token.`);
    }
    const logReasons = Array.isArray(scenario.log.reasonCodes) ? scenario.log.reasonCodes : [];
    if (JSON.stringify(logReasons) !== JSON.stringify(scenario.runtime.reasonCodes)) issues.push(`scenarios[${index}].log.reasonCodes must match runtime.reasonCodes.`);
  });
  return boundIssues(issues) as string[];
}

function validateRuntimeSignals(snapshot: M075S05EvidenceSnapshot): string[] {
  const issues: string[] = [];
  snapshot.scenarios.forEach((scenario, index) => {
    const { runtime, log } = scenario;
    if (runtime.classification !== runtime.gateResult || log.gateResult !== runtime.classification || log.classification !== runtime.classification) issues.push(`scenarios[${index}] classification/gateResult mismatch.`);
    if (log.mode !== runtime.mode) issues.push(`scenarios[${index}].log.mode must match runtime.mode.`);
    if (typeof runtime.deliveryId !== "string" || runtime.deliveryId.length === 0 || log.deliveryId !== runtime.deliveryId) issues.push(`scenarios[${index}] deliveryId correlation is missing or mismatched.`);
    if (typeof runtime.reviewOutputKey !== "string" || !SAFE_REVIEW_OUTPUT_KEY.test(runtime.reviewOutputKey) || log.reviewOutputKey !== runtime.reviewOutputKey) issues.push(`scenarios[${index}] reviewOutputKey correlation is missing or unsafe.`);
    if (runtime.redaction.rawPayloadOmitted !== true || runtime.redaction.unsafeInputOmitted !== false || runtime.redaction.boundedReasonCodes !== true) issues.push(`scenarios[${index}].runtime.redaction flags are not safe.`);
    for (const [key, value] of Object.entries(runtime.counts)) {
      if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > 10_000)) issues.push(`scenarios[${index}].runtime.counts.${key} is not bounded.`);
      if (Array.isArray(value)) issues.push(`scenarios[${index}].runtime.counts.${key} must not be an array.`);
    }
  });
  return boundIssues(issues) as string[];
}

function validateTelemetryTaxonomy(snapshot: M075S05EvidenceSnapshot, taxonomyText: string): string[] {
  const issues: string[] = [];
  const expectedClasses = new Set(["review-timeout-classification.expected-bounded-outcome", "review-timeout-classification.hard-failure", "review-timeout-classification.long-run-threshold"]);
  snapshot.scenarios.forEach((scenario, index) => {
    if (scenario.telemetry.timeoutClassification !== scenario.runtime.classification) issues.push(`scenarios[${index}].telemetry.timeoutClassification must match runtime.classification.`);
    if (scenario.telemetry.timeoutClassificationMode !== scenario.runtime.mode) issues.push(`scenarios[${index}].telemetry.timeoutClassificationMode must match runtime.mode.`);
    if (JSON.stringify(scenario.telemetry.timeoutClassificationReasons) !== JSON.stringify(scenario.runtime.reasonCodes)) issues.push(`scenarios[${index}].telemetry.timeoutClassificationReasons must match runtime.reasonCodes.`);
    if (!expectedClasses.has(scenario.taxonomy.classId)) issues.push(`scenarios[${index}].taxonomy.classId is not an S05 structured taxonomy class.`);
    if (scenario.runtime.mode === "long-run-threshold-exceeded" && scenario.taxonomy.classId !== "review-timeout-classification.long-run-threshold") issues.push(`scenarios[${index}] long-run threshold must map to long-run taxonomy class.`);
    if (scenario.runtime.classification === "hard-failure" && scenario.taxonomy.actionable !== true) issues.push(`scenarios[${index}] hard failure must remain actionable.`);
    if (scenario.runtime.classification === "expected-bounded-outcome" && scenario.taxonomy.classId !== "review-timeout-classification.expected-bounded-outcome") issues.push(`scenarios[${index}] expected bounded outcome must not map to raw ambiguous timeout noise.`);
  });
  for (const classId of expectedClasses) {
    if (!taxonomyText.includes(classId)) issues.push(`production taxonomy is missing ${classId}.`);
  }
  return boundIssues(issues) as string[];
}

function validateRedaction(snapshot: M075S05EvidenceSnapshot): string[] {
  const issues = findForbiddenCanaryPaths(snapshot).map((path) => `forbidden raw key/value at ${path}.`);
  return boundIssues(issues) as string[];
}

function validateBounds(snapshot: M075S05EvidenceSnapshot): string[] {
  const issues: string[] = [];
  if (snapshot.scenarios.length === 0) issues.push("scenarios must be non-empty.");
  if (snapshot.scenarios.length > MAX_SCENARIOS) issues.push(`scenarios length ${snapshot.scenarios.length} exceeds ${MAX_SCENARIOS}.`);
  snapshot.scenarios.forEach((scenario, index) => {
    if (scenario.name.length > 80) issues.push(`scenarios[${index}].name exceeds 80 chars.`);
    if (JSON.stringify(scenario).length > 8_000) issues.push(`scenarios[${index}] serialized evidence exceeds per-scenario cap.`);
  });
  return boundIssues(issues) as string[];
}

function validateNegativeControls(snapshot: M075S05EvidenceSnapshot): string[] {
  const issues: string[] = [];
  for (const key of REQUIRED_NEGATIVE_CONTROLS) {
    if (snapshot.negativeControls[key] !== true) issues.push(`negativeControls.${key} must be true.`);
  }
  return issues;
}

function packageWiringCheck(packageWiringPresent: boolean): M075S05Check { return packageWiringPresent ? pass("package-wiring.present", "package.json exposes verify:m075:s05.") : fail("package-wiring.present", "package.json verify:m075:s05 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]); }
function reportFailure(generatedAt: string, fixturePath: string, statusCode: M075S05StatusCode, checks: readonly M075S05Check[]): M075S05Report { const failed = checks.filter((check) => check.status !== "pass"); return { command: COMMAND_NAME, generatedAt, success: false, statusCode, fixturePath, failedCheckIds: uniqueSorted(failed.map((check) => check.id)), checks, observed: EMPTY_OBSERVED, issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))) }; }
function pass(id: M075S05CheckId, message: string): M075S05Check { return { id, status: "pass", message, issues: [] }; }
function fail(id: M075S05CheckId, message: string, issues: readonly string[]): M075S05Check { return { id, status: "fail", message, issues: boundIssues(issues) }; }
function hasExpectedPackageScript(packageJsonText: string): boolean { try { const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> }; return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT; } catch { return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`) || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`); } }
function assertSafeFixturePath(fixturePath: string): void { if (!fixturePath || isAbsolute(fixturePath)) throw new Error("invalid_cli_args: --fixture must be a repo-relative path"); const normalized = normalize(fixturePath).replaceAll(sep, "/"); if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) throw new Error("invalid_cli_args: --fixture must not traverse outside the repo"); if (FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) throw new Error("invalid_cli_args: --fixture must not read ignored or live-only paths"); if (!normalized.endsWith(".json")) throw new Error("invalid_cli_args: --fixture must be a JSON file"); }
function resolveFixtureReadPath(fixturePath: string): string { assertSafeFixturePath(fixturePath); return `${PROJECT_ROOT}/${normalize(fixturePath).replaceAll(sep, "/")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] { return [...new Set(values)].sort(); }
function boundIssues(issues: readonly string[]): readonly string[] { return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 240 ? `${issue.slice(0, 237)}...` : issue); }
function findForbiddenCanaryPaths(value: unknown, path = "$", paths: string[] = []): string[] {
  if (paths.length >= MAX_ISSUES) return paths;
  if (typeof value === "string") { if (FORBIDDEN_RAW_VALUE.test(value)) paths.push(path); return paths; }
  if (Array.isArray(value)) { value.forEach((item, index) => findForbiddenCanaryPaths(item, `${path}[${index}]`, paths)); return paths; }
  if (!isRecord(value)) return paths;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_KEY.test(key)) paths.push(childPath);
    findForbiddenCanaryPaths(child, childPath, paths);
  }
  return paths;
}

export async function main(rawArgs = Bun.argv.slice(2), options: M075S05MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M075S05Args;
  try { args = parseM075S05Args(rawArgs); } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m075_s05_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) { stdout.write(HELP_TEXT); return 0; }
  const effectiveArgs = args.fixturePath ? args : { ...args, fixturePath: DEFAULT_FIXTURE_PATH };
  const report = await (options.evaluate ?? ((parsed) => evaluateM075S05Contract(parsed)))(effectiveArgs);
  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write([`${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`, `statusCode=${report.statusCode}`, `scenarios=${report.observed.scenarioCount} modes=${report.observed.modeCount}`, `expectedBounded=${report.observed.expectedBoundedCount} hardFailures=${report.observed.hardFailureCount} actionable=${report.observed.actionableCount}`, `failedChecks=${report.failedCheckIds.join(",") || "none"}`, ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []), ""].join("\n"));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
