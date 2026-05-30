import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMAND_NAME = "verify:m075:s06" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s06.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m075-s06-addon-check-classification.json" as const;

export type M075S06StatusCode =
  | "m075_s06_ok"
  | "m075_s06_contract_failed"
  | "m075_s06_fixture_read_failed"
  | "m075_s06_invalid_json"
  | "m075_s06_malformed_evidence"
  | "m075_s06_invalid_arg";
export type M075S06CheckStatus = "pass" | "fail";
export type M075S06CheckId =
  | "fixture.shape"
  | "mode-coverage.present"
  | "reason-codes.safe"
  | "runtime-signals.present"
  | "comment-diagnostics.present"
  | "taxonomy.present"
  | "redaction.safe"
  | "output.bounded"
  | "negative-controls.present"
  | "package-wiring.present";
export type M075S06Classification = "expected-bounded-outcome" | "actionable-diagnostic" | "unknown";
export type M075S06Mode =
  | "completed-clean"
  | "completed-with-findings"
  | "partial-timeout"
  | "all-timeout"
  | "mixed-incomplete"
  | "tool-unavailable"
  | "unknown-malformed-evidence";
export type M075S06Args = { readonly json: boolean; readonly help: boolean; readonly fixturePath?: string };
export type M075S06Check = { readonly id: M075S06CheckId; readonly status: M075S06CheckStatus; readonly message: string; readonly issues: readonly string[] };
export type M075S06Counts = {
  readonly addonCount: number;
  readonly completedCount: number;
  readonly timedOutCount: number;
  readonly toolNotFoundCount: number;
  readonly findingCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly timeBudgetMs: number;
};
export type M075S06Scenario = {
  readonly name: string;
  readonly runtime: {
    readonly gate: "addon-check-classification";
    readonly classification: M075S06Classification;
    readonly gateResult: M075S06Classification;
    readonly mode: M075S06Mode;
    readonly reasonCodes: readonly string[];
    readonly counts: M075S06Counts;
    readonly redaction: Record<string, boolean>;
    readonly deliveryId: string;
    readonly repo: string;
    readonly prNumber: number;
  };
  readonly log: Record<string, unknown>;
  readonly comment: Record<string, unknown>;
  readonly taxonomy: { readonly classId: string; readonly actionable: boolean };
};
export type M075S06EvidenceSnapshot = {
  readonly schema: "m075-s06-addon-check-classification.v1";
  readonly generatedAt: string;
  readonly scenarios: readonly M075S06Scenario[];
  readonly negativeControls: Record<string, boolean>;
};
export type M075S06Observed = { readonly scenarioCount: number; readonly modeCount: number; readonly expectedBoundedCount: number; readonly actionableDiagnosticCount: number; readonly malformedEvidenceCount: number };
export type M075S06Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M075S06StatusCode;
  readonly fixturePath?: string;
  readonly failedCheckIds: readonly M075S06CheckId[];
  readonly checks: readonly M075S06Check[];
  readonly observed: M075S06Observed;
  readonly issues: readonly string[];
};
export type EvaluateM075S06Options = {
  readonly generatedAt?: string;
  readonly readFileText?: (path: string) => Promise<string>;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly readTaxonomyText?: () => Promise<string>;
};
export type M075S06Writer = { readonly write: (chunk: string) => unknown };
export type M075S06MainOptions = { readonly stdout?: M075S06Writer; readonly stderr?: M075S06Writer; readonly evaluate?: (args: M075S06Args) => Promise<M075S06Report> };

const HELP_TEXT = `Usage: bun scripts/verify-m075-s06.ts [--fixture <path>] [--json] [--help]\n\nVerifies fixture-only addon-check classification evidence for M075/S06. Live mode is intentionally unsupported; the verifier reads one bounded JSON fixture and checks mode coverage, safe reason codes, structured runtime/log/comment/taxonomy evidence, redaction, negative controls, and package wiring.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_FIXTURE_BYTES = 100_000;
const MAX_ISSUES = 24;
const MAX_SCENARIOS = 16;
const MAX_REASON_CODES = 8;
const MAX_REASON_LENGTH = 80;
const MAX_COUNT = 10_000;
const MAX_TIME_BUDGET_MS = 3_600_000;
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const REQUIRED_MODES = ["completed-clean", "completed-with-findings", "partial-timeout", "all-timeout", "mixed-incomplete", "tool-unavailable", "unknown-malformed-evidence"] as const satisfies readonly M075S06Mode[];
const REQUIRED_NEGATIVE_CONTROLS = ["invalidJsonRejected", "missingFixtureRejected", "ignoredPathRejected", "liveModeRejected", "missingModeRejected", "rawCanariesRejected", "unsafeReasonCodesRejected", "emptyReasonsRejected", "unboundedArraysRejected", "unboundedCountsRejected", "taxonomyCollapseRejected", "packageWiringDriftRejected"] as const;
const REQUIRED_COUNT_KEYS = ["addonCount", "completedCount", "timedOutCount", "toolNotFoundCount", "findingCount", "errorCount", "warningCount", "timeBudgetMs"] as const;
const EXPECTED_CLASSES = new Set(["addon-check-classification.expected-bounded-outcome", "addon-check-classification.actionable-diagnostic", "addon-check-classification.malformed-evidence"]);
const SAFE_REASON = /^[a-z0-9][a-z0-9-]{1,79}$/;
const SAFE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FORBIDDEN_RAW_KEY = /(^|_)(raw(Log|Payload|Prompt|Model|Diff|CheckerOutput)|raw_log|raw_payload|rawCheckerOutput|checkerStdout|checkerStderr|stdout|stderr|workspacePath|workspaceDir|addonPath|addonDir|addonIdentifiers|addonNames|githubPayload|prompt|modelOutput|candidateBody|candidatePayload|diff|patch|hunk|secret|token|apiKey|password)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|RAW_CHECKER_OUTPUT_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|WORKSPACE_PATH_CANARY|GITHUB_PAYLOAD_CANARY|PROMPT_SECRET|TOKEN=|diff --git|sk-[a-z0-9]|ghp_|github_pat_|\/home\/|\/tmp\/|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const EMPTY_OBSERVED: M075S06Observed = { scenarioCount: 0, modeCount: 0, expectedBoundedCount: 0, actionableDiagnosticCount: 0, malformedEvidenceCount: 0 };

export function parseM075S06Args(args: readonly string[]): M075S06Args {
  const parsed: Partial<M075S06Args> = { json: false, help: false };
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
    if (arg === "--live") throw new Error("invalid_cli_args: verify:m075:s06 is fixture-only; live mode is intentionally unsupported");
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return parsed as M075S06Args;
}

export async function evaluateM075S06Contract(args: M075S06Args = parseM075S06Args(["--fixture", DEFAULT_FIXTURE_PATH]), options: EvaluateM075S06Options = {}): Promise<M075S06Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const taxonomyText = await (options.readTaxonomyText ?? (() => Bun.file("src/review-audit/production-log-taxonomy.ts").text()))().catch(() => "");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageText));
  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  let text: string;
  try {
    text = await (options.readFileText ?? ((path) => Bun.file(resolveFixtureReadPath(path)).text()))(fixturePath);
  } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s06_fixture_read_failed", [fail("fixture.shape", "Fixture could not be read.", ["Fixture path is missing or unreadable."]), packageCheck]);
  }
  if (text.length > MAX_FIXTURE_BYTES) {
    return reportFailure(generatedAt, fixturePath, "m075_s06_malformed_evidence", [fail("fixture.shape", "Fixture is larger than the verifier cap.", [`fixture bytes ${text.length} exceeds ${MAX_FIXTURE_BYTES}.`]), packageCheck]);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s06_invalid_json", [fail("fixture.shape", "Fixture JSON could not be parsed.", ["Fixture JSON could not be parsed."]), packageCheck]);
  }
  const snapshot = normalizeEvidenceSnapshot(parsed);
  if (!snapshot) {
    return reportFailure(generatedAt, fixturePath, "m075_s06_malformed_evidence", [fail("fixture.shape", "Evidence shape is malformed.", ["schema/generatedAt/scenarios/negativeControls shape is missing or invalid."]), packageCheck]);
  }
  const evaluation = evaluateEvidence(snapshot, packageCheck, taxonomyText);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s06_ok" : "m075_s06_contract_failed",
    fixturePath,
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))),
  };
}

export function evaluateEvidence(snapshot: M075S06EvidenceSnapshot, packageCheck: M075S06Check = packageWiringCheck(true), taxonomyText = ""): { readonly checks: readonly M075S06Check[]; readonly observed: M075S06Observed } {
  const modes = new Set(snapshot.scenarios.map((scenario) => scenario.runtime.mode));
  const observed: M075S06Observed = {
    scenarioCount: snapshot.scenarios.length,
    modeCount: modes.size,
    expectedBoundedCount: snapshot.scenarios.filter((scenario) => scenario.runtime.classification === "expected-bounded-outcome").length,
    actionableDiagnosticCount: snapshot.scenarios.filter((scenario) => scenario.runtime.classification === "actionable-diagnostic").length,
    malformedEvidenceCount: snapshot.scenarios.filter((scenario) => scenario.runtime.mode === "unknown-malformed-evidence").length,
  };
  const checks: M075S06Check[] = [pass("fixture.shape", "Evidence has the bounded S06 addon-check classification shape.")];

  const coverageIssues = REQUIRED_MODES.filter((mode) => !modes.has(mode)).map((mode) => `mode ${mode} is missing.`);
  checks.push(coverageIssues.length === 0 ? pass("mode-coverage.present", "Fixture covers clean, findings, partial-timeout, all-timeout, mixed-incomplete, tool-unavailable, and malformed-evidence modes.") : fail("mode-coverage.present", "Required addon-check classification modes are missing.", coverageIssues));

  const reasonIssues = validateReasonCodes(snapshot);
  checks.push(reasonIssues.length === 0 ? pass("reason-codes.safe", "Every scenario has non-empty safe bounded reason codes.") : fail("reason-codes.safe", "Reason code evidence is empty, unsafe, or unbounded.", reasonIssues));

  const runtimeIssues = validateRuntimeSignals(snapshot);
  checks.push(runtimeIssues.length === 0 ? pass("runtime-signals.present", "Runtime and structured log evidence expose gate, classification, mode, reason codes, bounded counts, and PR correlation keys.") : fail("runtime-signals.present", "Runtime/log evidence is missing required safe fields.", runtimeIssues));

  const commentIssues = validateCommentDiagnostics(snapshot);
  checks.push(commentIssues.length === 0 ? pass("comment-diagnostics.present", "PR comment diagnostics expose only bounded classification, mode, reason, actionability, and count state.") : fail("comment-diagnostics.present", "Comment diagnostic evidence is missing or unsafe.", commentIssues));

  const taxonomyIssues = validateTaxonomy(snapshot, taxonomyText);
  checks.push(taxonomyIssues.length === 0 ? pass("taxonomy.present", "Production taxonomy distinguishes structured addon-check bounded outcomes, actionable diagnostics, malformed evidence, and legacy raw timeout noise.") : fail("taxonomy.present", "Taxonomy mapping is incomplete or collapsed.", taxonomyIssues));

  const redactionIssues = validateRedaction(snapshot);
  checks.push(redactionIssues.length === 0 ? pass("redaction.safe", "Fixture excludes raw checker output, workspace paths, GitHub payloads, addon identifiers, raw logs, and secrets.") : fail("redaction.safe", "Unsafe raw evidence reached the verifier surface.", redactionIssues));

  const boundIssuesFound = validateBounds(snapshot);
  checks.push(boundIssuesFound.length === 0 ? pass("output.bounded", "Fixture scenarios, reason arrays, counts, and issue output remain bounded.") : fail("output.bounded", "Verifier-visible output exceeded bounds.", boundIssuesFound));

  const negativeIssues = validateNegativeControls(snapshot);
  checks.push(negativeIssues.length === 0 ? pass("negative-controls.present", "Fixture declares negative controls for malformed fixtures, missing modes, live mode, unsafe evidence, unbounded counts, taxonomy collapse, and package drift.") : fail("negative-controls.present", "Required negative controls are absent.", negativeIssues));

  checks.push(packageCheck);
  return { checks, observed };
}

function normalizeEvidenceSnapshot(value: unknown): M075S06EvidenceSnapshot | null {
  if (!isRecord(value) || value.schema !== "m075-s06-addon-check-classification.v1" || typeof value.generatedAt !== "string") return null;
  if (!Array.isArray(value.scenarios) || !isRecord(value.negativeControls)) return null;
  for (const scenario of value.scenarios) {
    if (!isRecord(scenario) || typeof scenario.name !== "string" || !isRecord(scenario.runtime) || !isRecord(scenario.log) || !isRecord(scenario.comment) || !isRecord(scenario.taxonomy)) return null;
    if (scenario.runtime.gate !== "addon-check-classification" || scenario.log.gate !== "addon-check-classification") return null;
    if (!Array.isArray(scenario.runtime.reasonCodes) || !isRecord(scenario.runtime.counts) || !isRecord(scenario.runtime.redaction)) return null;
  }
  return value as M075S06EvidenceSnapshot;
}

function validateReasonCodes(snapshot: M075S06EvidenceSnapshot): string[] {
  const issues: string[] = [];
  snapshot.scenarios.forEach((scenario, index) => {
    const reasons = scenario.runtime.reasonCodes.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).map((reason) => reason.trim());
    if (reasons.length === 0) issues.push(`scenarios[${index}].runtime.reasonCodes must be non-empty.`);
    if (reasons.length > MAX_REASON_CODES) issues.push(`scenarios[${index}].runtime.reasonCodes exceeds ${MAX_REASON_CODES}.`);
    for (const reason of reasons) {
      if (reason.length > MAX_REASON_LENGTH || !SAFE_REASON.test(reason) || FORBIDDEN_RAW_VALUE.test(reason)) issues.push(`scenarios[${index}].runtime.reasonCodes contains unsafe reason token.`);
    }
    const logReasons = Array.isArray(scenario.log.reasonCodes) ? scenario.log.reasonCodes : [];
    const commentReasons = Array.isArray(scenario.comment.reasonCodes) ? scenario.comment.reasonCodes : [];
    if (JSON.stringify(logReasons) !== JSON.stringify(scenario.runtime.reasonCodes)) issues.push(`scenarios[${index}].log.reasonCodes must match runtime.reasonCodes.`);
    if (JSON.stringify(commentReasons) !== JSON.stringify(scenario.runtime.reasonCodes)) issues.push(`scenarios[${index}].comment.reasonCodes must match runtime.reasonCodes.`);
  });
  return boundIssues(issues) as string[];
}

function validateRuntimeSignals(snapshot: M075S06EvidenceSnapshot): string[] {
  const issues: string[] = [];
  snapshot.scenarios.forEach((scenario, index) => {
    const { runtime, log } = scenario;
    if (runtime.classification !== runtime.gateResult || log.gateResult !== runtime.classification || log.classification !== runtime.classification) issues.push(`scenarios[${index}] classification/gateResult mismatch.`);
    if (log.mode !== runtime.mode) issues.push(`scenarios[${index}].log.mode must match runtime.mode.`);
    if (typeof runtime.deliveryId !== "string" || runtime.deliveryId.length === 0 || log.deliveryId !== runtime.deliveryId) issues.push(`scenarios[${index}] deliveryId correlation is missing or mismatched.`);
    if (typeof runtime.repo !== "string" || !SAFE_REPO.test(runtime.repo) || log.repo !== runtime.repo) issues.push(`scenarios[${index}] repo correlation is missing or unsafe.`);
    if (!Number.isInteger(runtime.prNumber) || runtime.prNumber <= 0 || log.prNumber !== runtime.prNumber) issues.push(`scenarios[${index}] PR correlation is missing or mismatched.`);
    if (runtime.redaction.rawCheckerOutputOmitted !== true || runtime.redaction.workspacePathsOmitted !== true || runtime.redaction.githubPayloadOmitted !== true || runtime.redaction.addonIdentifiersOmitted !== true || runtime.redaction.boundedReasonCodes !== true || runtime.redaction.rawCanaryDetected !== false) issues.push(`scenarios[${index}].runtime.redaction flags are not safe.`);
    for (const key of REQUIRED_COUNT_KEYS) {
      const value = runtime.counts[key];
      const max = key === "timeBudgetMs" ? MAX_TIME_BUDGET_MS : MAX_COUNT;
      if (!Number.isInteger(value) || value < 0 || value > max) issues.push(`scenarios[${index}].runtime.counts.${key} is not bounded.`);
    }
  });
  return boundIssues(issues) as string[];
}

function validateCommentDiagnostics(snapshot: M075S06EvidenceSnapshot): string[] {
  const issues: string[] = [];
  snapshot.scenarios.forEach((scenario, index) => {
    if (scenario.comment.summaryKind !== "addon-check-classification") issues.push(`scenarios[${index}].comment.summaryKind must identify addon-check classification.`);
    if (scenario.comment.classification !== scenario.runtime.classification) issues.push(`scenarios[${index}].comment.classification must match runtime.classification.`);
    if (scenario.comment.mode !== scenario.runtime.mode) issues.push(`scenarios[${index}].comment.mode must match runtime.mode.`);
    if (scenario.comment.actionableDiagnostic !== (scenario.runtime.classification === "actionable-diagnostic")) issues.push(`scenarios[${index}].comment.actionableDiagnostic must match runtime actionability.`);
    if (scenario.comment.bounded !== true) issues.push(`scenarios[${index}].comment.bounded must be true.`);
  });
  return boundIssues(issues) as string[];
}

function validateTaxonomy(snapshot: M075S06EvidenceSnapshot, taxonomyText: string): string[] {
  const issues: string[] = [];
  snapshot.scenarios.forEach((scenario, index) => {
    if (!EXPECTED_CLASSES.has(scenario.taxonomy.classId)) issues.push(`scenarios[${index}].taxonomy.classId is not an S06 structured taxonomy class.`);
    if (scenario.runtime.mode === "unknown-malformed-evidence" && scenario.taxonomy.classId !== "addon-check-classification.malformed-evidence") issues.push(`scenarios[${index}] malformed evidence must map to malformed-evidence taxonomy class.`);
    if (scenario.runtime.classification === "actionable-diagnostic" && scenario.taxonomy.classId !== "addon-check-classification.actionable-diagnostic") issues.push(`scenarios[${index}] actionable diagnostic must map to actionable-diagnostic taxonomy class.`);
    if (scenario.runtime.classification === "expected-bounded-outcome" && scenario.taxonomy.classId !== "addon-check-classification.expected-bounded-outcome") issues.push(`scenarios[${index}] expected bounded outcome must not map to raw addon-check timeout noise.`);
    if ((scenario.runtime.classification === "actionable-diagnostic" || scenario.runtime.mode === "unknown-malformed-evidence") && scenario.taxonomy.actionable !== true) issues.push(`scenarios[${index}] actionable or malformed evidence must remain actionable.`);
  });
  for (const classId of EXPECTED_CLASSES) {
    if (!taxonomyText.includes(classId)) issues.push(`production taxonomy is missing ${classId}.`);
  }
  if (!taxonomyText.includes("addon-check.timeout")) issues.push("production taxonomy must retain legacy addon-check.timeout fallback.");
  if (!taxonomyText.includes("classifyStructuredAddonCheck")) issues.push("production taxonomy must map structured addon-check rows before raw timeout text.");
  return boundIssues(issues) as string[];
}

function validateRedaction(snapshot: M075S06EvidenceSnapshot): string[] {
  return boundIssues(findForbiddenCanaryPaths(snapshot).map((path) => `forbidden raw key/value at ${path}.`)) as string[];
}

function validateBounds(snapshot: M075S06EvidenceSnapshot): string[] {
  const issues: string[] = [];
  if (snapshot.scenarios.length === 0) issues.push("scenarios must be non-empty.");
  if (snapshot.scenarios.length > MAX_SCENARIOS) issues.push(`scenarios length ${snapshot.scenarios.length} exceeds ${MAX_SCENARIOS}.`);
  snapshot.scenarios.forEach((scenario, index) => {
    if (scenario.name.length > 80) issues.push(`scenarios[${index}].name exceeds 80 chars.`);
    if (JSON.stringify(scenario).length > 8_000) issues.push(`scenarios[${index}] serialized evidence exceeds per-scenario cap.`);
  });
  return boundIssues(issues) as string[];
}

function validateNegativeControls(snapshot: M075S06EvidenceSnapshot): string[] {
  const issues: string[] = [];
  for (const key of REQUIRED_NEGATIVE_CONTROLS) {
    if (snapshot.negativeControls[key] !== true) issues.push(`negativeControls.${key} must be true.`);
  }
  return issues;
}

function packageWiringCheck(packageWiringPresent: boolean): M075S06Check { return packageWiringPresent ? pass("package-wiring.present", "package.json exposes verify:m075:s06.") : fail("package-wiring.present", "package.json verify:m075:s06 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]); }
function reportFailure(generatedAt: string, fixturePath: string, statusCode: M075S06StatusCode, checks: readonly M075S06Check[]): M075S06Report { const failed = checks.filter((check) => check.status !== "pass"); return { command: COMMAND_NAME, generatedAt, success: false, statusCode, fixturePath, failedCheckIds: uniqueSorted(failed.map((check) => check.id)), checks, observed: EMPTY_OBSERVED, issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))) }; }
function pass(id: M075S06CheckId, message: string): M075S06Check { return { id, status: "pass", message, issues: [] }; }
function fail(id: M075S06CheckId, message: string, issues: readonly string[]): M075S06Check { return { id, status: "fail", message, issues: boundIssues(issues) }; }
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

export async function main(rawArgs = Bun.argv.slice(2), options: M075S06MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M075S06Args;
  try { args = parseM075S06Args(rawArgs); } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m075_s06_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) { stdout.write(HELP_TEXT); return 0; }
  const effectiveArgs = args.fixturePath ? args : { ...args, fixturePath: DEFAULT_FIXTURE_PATH };
  const report = await (options.evaluate ?? ((parsed) => evaluateM075S06Contract(parsed)))(effectiveArgs);
  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write([`${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`, `statusCode=${report.statusCode}`, `scenarios=${report.observed.scenarioCount} modes=${report.observed.modeCount}`, `expectedBounded=${report.observed.expectedBoundedCount} actionableDiagnostics=${report.observed.actionableDiagnosticCount} malformedEvidence=${report.observed.malformedEvidenceCount}`, `failedChecks=${report.failedCheckIds.join(",") || "none"}`, ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []), ""].join("\n"));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
