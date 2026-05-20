import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductionLogBaselineReport, type ProductionLogBaselineReport, type ProductionLogBaselineWindowReport, type ProductionLogDownstreamOwner, type ProductionLogIssueClassId, type ProductionLogIssueClassification, type ProductionLogObservation, type ProductionLogSourceAvailability, type ProductionLogWindowId } from "../src/review-audit/production-log-taxonomy.ts";
import { discoverLogAnalyticsWorkspaceIds, queryReviewAuditLogs, type NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";

export const COMMAND_NAME = "verify:m075:s01" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s01.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m075-s01-production-log-baseline.json" as const;

export type M075S01StatusCode =
  | "m075_s01_ok"
  | "m075_s01_contract_failed"
  | "m075_s01_malformed_evidence"
  | "m075_s01_fixture_read_failed"
  | "m075_s01_invalid_json"
  | "m075_s01_live_source_blocked"
  | "m075_s01_live_source_unavailable"
  | "m075_s01_invalid_arg";
export type M075S01CheckStatus = "pass" | "fail" | "blocked";
export type M075S01CheckId =
  | "fixture.shape"
  | "source.available"
  | "windows.required"
  | "classes.required"
  | "owner.mapping.exact"
  | "classification.separated"
  | "redaction.safe"
  | "output.bounded"
  | "package-wiring.present";
export type M075S01Args = {
  readonly json: boolean;
  readonly help: boolean;
  readonly live: boolean;
  readonly allowBlocked: boolean;
  readonly fixturePath?: string;
};
export type M075S01Check = { readonly id: M075S01CheckId; readonly status: M075S01CheckStatus; readonly message: string; readonly issues: readonly string[] };
export type M075S01QueryMetadata = {
  readonly mode: "fixture" | "live";
  readonly source: "fixture" | "azure-log-analytics";
  readonly windows: Record<ProductionLogWindowId, { readonly timespan: "PT12H" | "P7D"; readonly query: string | null; readonly limit: number }>;
};
export type M075S01Observed = {
  readonly sourceAvailability: ProductionLogSourceAvailability | "blocked";
  readonly workspaceCount: number;
  readonly windowsPresent: readonly ProductionLogWindowId[];
  readonly totalRows: number;
  readonly malformedRows: number;
  readonly classCounts: Record<ProductionLogIssueClassId, Record<ProductionLogWindowId, number>>;
  readonly queryMetadata: M075S01QueryMetadata;
};
export type M075S01EvidenceSnapshot = {
  readonly schema: "m075-s01-production-log-baseline.v1";
  readonly generatedAt: string;
  readonly report: ProductionLogBaselineReport;
  readonly queryMetadata?: M075S01QueryMetadata;
};
export type M075S01Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M075S01StatusCode;
  readonly fixturePath?: string;
  readonly failedCheckIds: readonly M075S01CheckId[];
  readonly checks: readonly M075S01Check[];
  readonly observed: M075S01Observed;
  readonly baseline?: ProductionLogBaselineReport;
  readonly issues: readonly string[];
};
export type M075S01LiveCollectors = {
  readonly discoverWorkspaces?: () => Promise<readonly string[]>;
  readonly queryLogs?: (params: { readonly workspaceIds: readonly string[]; readonly window: ProductionLogWindowId; readonly timespan: "PT12H" | "P7D"; readonly limit: number }) => Promise<{ readonly query: string; readonly rows: readonly NormalizedLogAnalyticsRow[] }>;
};
export type EvaluateM075S01Options = {
  readonly generatedAt?: string;
  readonly readFileText?: (path: string) => Promise<string>;
  readonly readPackageJsonText?: () => Promise<string>;
  readonly liveCollectors?: M075S01LiveCollectors;
};
export type M075S01Writer = { readonly write: (chunk: string) => unknown };
export type M075S01MainOptions = { readonly stdout?: M075S01Writer; readonly stderr?: M075S01Writer; readonly evaluate?: (args: M075S01Args) => Promise<M075S01Report> };

const HELP_TEXT = `Usage: bun scripts/verify-m075-s01.ts [--fixture <path> | --live] [--allow-blocked] [--json] [--help]\n\nVerifies bounded M075/S01 production-log baseline evidence for last-12h and last-7d windows. Fixture mode is the canonical local path; live mode queries Azure Log Analytics only when explicitly requested.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_ISSUES = 24;
const LIVE_LIMIT = 200;
const WINDOWS: readonly ProductionLogWindowId[] = ["last12h", "last7d"];
const TIMESPAAN_BY_WINDOW: Record<ProductionLogWindowId, "PT12H" | "P7D"> = { last12h: "PT12H", last7d: "P7D" };
const REQUIRED_CLASSES: readonly ProductionLogIssueClassId[] = [
  "knowledge-store.undefined-write",
  "inline-publication.line-not-commentable",
  "candidate-publication.non-approved-missing-reason",
  "review.timeout-or-long-run",
  "addon-check.timeout",
  "azure.platform-noise",
];
const REQUIRED_OWNER_MAPPING: Record<ProductionLogIssueClassId, { readonly classification: ProductionLogIssueClassification; readonly owner: ProductionLogDownstreamOwner }> = {
  "knowledge-store.undefined-write": { classification: "app-actionable", owner: "S02" },
  "inline-publication.line-not-commentable": { classification: "app-actionable", owner: "S03" },
  "candidate-publication.non-approved-missing-reason": { classification: "app-actionable", owner: "S04" },
  "review.timeout-or-long-run": { classification: "transient", owner: "S05" },
  "addon-check.timeout": { classification: "transient", owner: "S06" },
  "azure.platform-noise": { classification: "azure-platform", owner: null },
};
const EMPTY_QUERY_METADATA: M075S01QueryMetadata = {
  mode: "fixture",
  source: "fixture",
  windows: {
    last12h: { timespan: "PT12H", query: null, limit: LIVE_LIMIT },
    last7d: { timespan: "P7D", query: null, limit: LIVE_LIMIT },
  },
};
const EMPTY_OBSERVED: M075S01Observed = {
  sourceAvailability: "blocked",
  workspaceCount: 0,
  windowsPresent: [],
  totalRows: 0,
  malformedRows: 0,
  classCounts: Object.fromEntries(REQUIRED_CLASSES.map((id) => [id, { last12h: 0, last7d: 0 }])) as Record<ProductionLogIssueClassId, Record<ProductionLogWindowId, number>>,
  queryMetadata: EMPTY_QUERY_METADATA,
};
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const FORBIDDEN_RAW_KEY = /(^|_)(Log_s|rawLog|raw_log|rawPayload|raw_payload|prompt|modelOutput|candidateBody|candidatePayload|diff|patch|hunk|secret|token|apiKey|password)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|diff --git|ghp_|github_pat_|sk-[a-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function parseM075S01Args(args: readonly string[]): M075S01Args {
  const parsed: Partial<M075S01Args> = { json: false, help: false, live: false, allowBlocked: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") { parsed.json = true; continue; }
    if (arg === "--help" || arg === "-h") { parsed.help = true; continue; }
    if (arg === "--live") { parsed.live = true; continue; }
    if (arg === "--allow-blocked") { parsed.allowBlocked = true; continue; }
    if (arg === "--fixture") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("invalid_cli_args: --fixture requires a value");
      assertSafeFixturePath(value);
      parsed.fixturePath = value;
      index += 1;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  if (parsed.live && parsed.fixturePath) throw new Error("invalid_cli_args: choose either --live or --fixture, not both");
  return parsed as M075S01Args;
}

export async function evaluateM075S01Contract(args: M075S01Args = parseM075S01Args(["--fixture", DEFAULT_FIXTURE_PATH]), options: EvaluateM075S01Options = {}): Promise<M075S01Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageText));
  if (args.live) return evaluateM075S01LiveContract(args, { ...options, generatedAt, readPackageJsonText: async () => packageText });

  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  let text: string;
  try {
    text = await (options.readFileText ?? ((path) => Bun.file(resolveFixtureReadPath(path)).text()))(fixturePath);
  } catch {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m075_s01_fixture_read_failed",
      fixturePath,
      failedCheckIds: ["fixture.shape"],
      checks: [fail("fixture.shape", "Fixture could not be read.", ["Fixture path is missing or unreadable."]), packageCheck],
      observed: EMPTY_OBSERVED,
      issues: ["fixture.shape: Fixture path is missing or unreadable."],
    }, args);
  }

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m075_s01_invalid_json",
      fixturePath,
      failedCheckIds: ["fixture.shape"],
      checks: [fail("fixture.shape", "Fixture JSON could not be parsed.", ["Fixture JSON could not be parsed."]), packageCheck],
      observed: EMPTY_OBSERVED,
      issues: ["fixture.shape: Fixture JSON could not be parsed."],
    }, args);
  }

  const snapshot = normalizeEvidenceSnapshot(parsed, "fixture");
  if (!snapshot) {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m075_s01_malformed_evidence",
      fixturePath,
      failedCheckIds: ["fixture.shape"],
      checks: [fail("fixture.shape", "Evidence shape is malformed.", ["schema/report/windows shape is missing or invalid."]), packageCheck],
      observed: EMPTY_OBSERVED,
      issues: ["fixture.shape: schema/report/windows shape is missing or invalid."],
    }, args);
  }

  const evaluation = evaluateEvidence(snapshot, packageCheck);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  return finalizeReport({
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s01_ok" : "m075_s01_contract_failed",
    fixturePath,
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    baseline: snapshot.report,
    issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))),
  }, args);
}

export async function evaluateM075S01LiveContract(args: M075S01Args, options: EvaluateM075S01Options = {}): Promise<M075S01Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageText));
  const collectors = options.liveCollectors ?? buildDefaultLiveCollectors();
  if (!collectors.discoverWorkspaces || !collectors.queryLogs) {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m075_s01_live_source_blocked",
      failedCheckIds: ["source.available"],
      checks: [blocked("source.available", "Live Log Analytics source is blocked by missing configuration.", ["Azure credentials/resource group or workspace ids are not configured."]), packageCheck],
      observed: { ...EMPTY_OBSERVED, queryMetadata: { ...EMPTY_QUERY_METADATA, mode: "live", source: "azure-log-analytics" } },
      issues: ["source.available: Azure credentials/resource group or workspace ids are not configured."],
    }, args);
  }

  let workspaceIds: readonly string[];
  try {
    workspaceIds = await collectors.discoverWorkspaces();
  } catch (error) {
    return liveSourceUnavailable(generatedAt, args, packageCheck, `workspace discovery failed: ${compactError(error)}`);
  }
  if (workspaceIds.length === 0) {
    return finalizeReport({
      command: COMMAND_NAME,
      generatedAt,
      success: false,
      statusCode: "m075_s01_live_source_blocked",
      failedCheckIds: ["source.available"],
      checks: [blocked("source.available", "Live Log Analytics source is blocked by missing workspaces.", ["No Log Analytics workspace ids were discovered."]), packageCheck],
      observed: { ...EMPTY_OBSERVED, queryMetadata: { ...EMPTY_QUERY_METADATA, mode: "live", source: "azure-log-analytics" } },
      issues: ["source.available: No Log Analytics workspace ids were discovered."],
    }, args);
  }

  const windowInputs: Record<ProductionLogWindowId, { rows: NormalizedLogAnalyticsRow[]; sourceAvailability: ProductionLogSourceAvailability; workspaceCount: number }> = {
    last12h: { rows: [], sourceAvailability: "unavailable", workspaceCount: workspaceIds.length },
    last7d: { rows: [], sourceAvailability: "unavailable", workspaceCount: workspaceIds.length },
  };
  const queryMetadata: M075S01QueryMetadata = { mode: "live", source: "azure-log-analytics", windows: { last12h: { timespan: "PT12H", query: null, limit: LIVE_LIMIT }, last7d: { timespan: "P7D", query: null, limit: LIVE_LIMIT } } };
  try {
    for (const window of WINDOWS) {
      const timespan = TIMESPAAN_BY_WINDOW[window];
      const result = await collectors.queryLogs({ workspaceIds, window, timespan, limit: LIVE_LIMIT });
      queryMetadata.windows[window] = { timespan, query: result.query, limit: LIVE_LIMIT };
      windowInputs[window] = { rows: [...result.rows], sourceAvailability: result.rows.length > 0 ? "present" : "missing", workspaceCount: workspaceIds.length };
    }
  } catch (error) {
    return liveSourceUnavailable(generatedAt, args, packageCheck, `log query failed: ${compactError(error)}`);
  }

  const report = buildProductionLogBaselineReport({ generatedAt, windows: windowInputs });
  const snapshot: M075S01EvidenceSnapshot = { schema: "m075-s01-production-log-baseline.v1", generatedAt, report, queryMetadata };
  const evaluation = evaluateEvidence(snapshot, packageCheck);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  return finalizeReport({
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s01_ok" : "m075_s01_contract_failed",
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    baseline: report,
    issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))),
  }, args);
}

export function evaluateEvidence(snapshot: M075S01EvidenceSnapshot, packageCheck: M075S01Check = packageWiringCheck(true)): { readonly checks: readonly M075S01Check[]; readonly observed: M075S01Observed } {
  const checks: M075S01Check[] = [];
  checks.push(pass("fixture.shape", "Evidence has the bounded S01 production-log baseline shape."));
  const observed = buildObserved(snapshot);
  checks.push(observed.sourceAvailability === "present" || observed.sourceAvailability === "partial"
    ? pass("source.available", "At least one baseline source window is available.")
    : observed.sourceAvailability === "blocked"
      ? blocked("source.available", "Baseline source is blocked.", ["Live source did not run or fixture source is unavailable."])
      : fail("source.available", "Baseline source is missing or unavailable.", [`source availability=${observed.sourceAvailability}`]));
  const windowIssues = WINDOWS.filter((window) => !snapshot.report.windows[window]).map((window) => `${window} window is missing.`);
  checks.push(windowIssues.length === 0 ? pass("windows.required", "last12h and last7d windows are present.") : fail("windows.required", "Required query windows are missing.", windowIssues));
  const classIssues = validateRequiredClasses(snapshot.report);
  checks.push(classIssues.length === 0 ? pass("classes.required", "All required M075 issue classes are present in both windows.") : fail("classes.required", "Required issue class summaries are missing.", classIssues));
  const ownerIssues = validateOwnerMapping(snapshot.report);
  checks.push(ownerIssues.length === 0 ? pass("owner.mapping.exact", "Issue classes map exactly to downstream owner slices S02-S06 and platform null.") : fail("owner.mapping.exact", "Issue class downstream owner mapping drifted.", ownerIssues));
  const separationIssues = validateClassificationSeparation(snapshot.report);
  checks.push(separationIssues.length === 0 ? pass("classification.separated", "App-actionable classes are separated from Azure/platform and transient classes.") : fail("classification.separated", "Issue class classification separation drifted.", separationIssues));
  const redactionIssues = validateRedaction(snapshot);
  checks.push(redactionIssues.length === 0 ? pass("redaction.safe", "Baseline output excludes raw rows and secret-like payloads.") : fail("redaction.safe", "Unsafe raw evidence reached the verifier surface.", redactionIssues));
  const boundIssues = validateBounds(snapshot.report);
  checks.push(boundIssues.length === 0 ? pass("output.bounded", "Window output is bounded by class and example caps.") : fail("output.bounded", "Window output exceeded expected caps.", boundIssues));
  checks.push(packageCheck);
  return { checks, observed };
}

function normalizeEvidenceSnapshot(value: unknown, defaultMode: "fixture" | "live"): M075S01EvidenceSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.schema === "m075-s01-production-log-baseline.v1" && isRecord(value.report)) {
    const report = value.report as ProductionLogBaselineReport;
    if (!isBaselineReport(report)) return null;
    return { schema: "m075-s01-production-log-baseline.v1", generatedAt: String(value.generatedAt ?? report.generatedAt), report, queryMetadata: isQueryMetadata(value.queryMetadata) ? value.queryMetadata : defaultQueryMetadata(defaultMode) };
  }
  if (isBaselineReport(value)) {
    return { schema: "m075-s01-production-log-baseline.v1", generatedAt: String(value.generatedAt), report: value as ProductionLogBaselineReport, queryMetadata: defaultQueryMetadata(defaultMode) };
  }
  return null;
}

function isBaselineReport(value: unknown): value is ProductionLogBaselineReport {
  return isRecord(value) && typeof value.generatedAt === "string" && isRecord(value.windows) && isWindow(value.windows.last12h) && isWindow(value.windows.last7d);
}

function isWindow(value: unknown): value is ProductionLogBaselineWindowReport {
  return isRecord(value) && (value.window === "last12h" || value.window === "last7d") && isRecord(value.source) && Array.isArray(value.issueClasses) && isRecord(value.redaction);
}

function isQueryMetadata(value: unknown): value is M075S01QueryMetadata {
  return isRecord(value) && (value.mode === "fixture" || value.mode === "live") && isRecord(value.windows);
}

function defaultQueryMetadata(mode: "fixture" | "live"): M075S01QueryMetadata {
  return { ...EMPTY_QUERY_METADATA, mode, source: mode === "live" ? "azure-log-analytics" : "fixture" };
}

function validateRequiredClasses(report: ProductionLogBaselineReport): string[] {
  const issues: string[] = [];
  for (const window of WINDOWS) {
    const ids = new Set(report.windows[window]?.issueClasses.map((issueClass) => issueClass.id));
    for (const id of REQUIRED_CLASSES) if (!ids.has(id)) issues.push(`${window} missing ${id}.`);
  }
  return issues;
}

function validateOwnerMapping(report: ProductionLogBaselineReport): string[] {
  const issues: string[] = [];
  for (const window of WINDOWS) {
    for (const issueClass of report.windows[window].issueClasses) {
      const expected = REQUIRED_OWNER_MAPPING[issueClass.id as ProductionLogIssueClassId];
      if (!expected) continue;
      if (issueClass.downstreamOwner !== expected.owner) issues.push(`${window}.${issueClass.id} downstreamOwner expected ${expected.owner ?? "null"} got ${issueClass.downstreamOwner ?? "null"}.`);
      if (issueClass.downstreamOwner === "") issues.push(`${window}.${issueClass.id} downstreamOwner must not be empty.`);
    }
  }
  return issues;
}

function validateClassificationSeparation(report: ProductionLogBaselineReport): string[] {
  const issues: string[] = [];
  for (const window of WINDOWS) {
    for (const issueClass of report.windows[window].issueClasses) {
      const expected = REQUIRED_OWNER_MAPPING[issueClass.id as ProductionLogIssueClassId];
      if (!expected) continue;
      if (issueClass.classification !== expected.classification) issues.push(`${window}.${issueClass.id} classification expected ${expected.classification} got ${issueClass.classification}.`);
      if (issueClass.classification === "azure-platform" && issueClass.downstreamOwner !== null) issues.push(`${window}.${issueClass.id} platform class must not have app owner.`);
      if (issueClass.classification === "app-actionable" && !issueClass.downstreamOwner) issues.push(`${window}.${issueClass.id} app-actionable class must have downstream owner.`);
    }
  }
  return issues;
}

function validateRedaction(snapshot: M075S01EvidenceSnapshot): string[] {
  const issues: string[] = [];
  for (const window of WINDOWS) {
    const redaction = snapshot.report.windows[window].redaction;
    if (!redaction.passed) issues.push(`${window} redaction.passed must be true.`);
    if (!redaction.rawPayloadsExcluded) issues.push(`${window} rawPayloadsExcluded must be true.`);
    if (redaction.violations.length > 0) issues.push(`${window} redaction violations must be empty.`);
  }
  findForbiddenCanaryPaths(snapshot.report).forEach((path) => issues.push(`forbidden raw key/value at ${path}.`));
  return boundIssues(issues) as string[];
}

function validateBounds(report: ProductionLogBaselineReport): string[] {
  const issues: string[] = [];
  for (const window of WINDOWS) {
    const current = report.windows[window];
    if (current.issueClasses.length !== REQUIRED_CLASSES.length) issues.push(`${window} class count expected ${REQUIRED_CLASSES.length} got ${current.issueClasses.length}.`);
    for (const issueClass of current.issueClasses) {
      if (issueClass.examples.length > current.redaction.maxExamplesPerClass) issues.push(`${window}.${issueClass.id} examples exceed maxExamplesPerClass.`);
    }
  }
  return issues;
}

function buildObserved(snapshot: M075S01EvidenceSnapshot): M075S01Observed {
  const windowsPresent = WINDOWS.filter((window) => Boolean(snapshot.report.windows[window]));
  const availabilitySet = new Set(windowsPresent.map((window) => snapshot.report.windows[window].source.availability));
  const sourceAvailability: M075S01Observed["sourceAvailability"] = availabilitySet.has("present") ? "present" : availabilitySet.has("partial") ? "partial" : availabilitySet.has("unavailable") ? "unavailable" : availabilitySet.has("missing") ? "missing" : "blocked";
  const classCounts = Object.fromEntries(REQUIRED_CLASSES.map((id) => [id, Object.fromEntries(WINDOWS.map((window) => [window, snapshot.report.windows[window]?.issueClasses.find((issueClass) => issueClass.id === id)?.count ?? 0]))])) as Record<ProductionLogIssueClassId, Record<ProductionLogWindowId, number>>;
  return {
    sourceAvailability,
    workspaceCount: Math.max(...windowsPresent.map((window) => snapshot.report.windows[window].source.workspaceCount), 0),
    windowsPresent,
    totalRows: windowsPresent.reduce((sum, window) => sum + snapshot.report.windows[window].totalRowCount, 0),
    malformedRows: windowsPresent.reduce((sum, window) => sum + snapshot.report.windows[window].malformedRowCount, 0),
    classCounts,
    queryMetadata: snapshot.queryMetadata ?? EMPTY_QUERY_METADATA,
  };
}

function packageWiringCheck(packageWiringPresent: boolean): M075S01Check {
  return packageWiringPresent ? pass("package-wiring.present", "package.json exposes verify:m075:s01.") : fail("package-wiring.present", "package.json verify:m075:s01 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]);
}
function pass(id: M075S01CheckId, message: string): M075S01Check { return { id, status: "pass", message, issues: [] }; }
function fail(id: M075S01CheckId, message: string, issues: readonly string[]): M075S01Check { return { id, status: "fail", message, issues: boundIssues(issues) }; }
function blocked(id: M075S01CheckId, message: string, issues: readonly string[]): M075S01Check { return { id, status: "blocked", message, issues: boundIssues(issues) }; }
function hasExpectedPackageScript(packageJsonText: string): boolean {
  try { const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> }; return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT; }
  catch { return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`) || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`); }
}
function assertSafeFixturePath(fixturePath: string): void {
  if (!fixturePath || isAbsolute(fixturePath)) throw new Error("invalid_cli_args: --fixture must be a repo-relative path");
  const normalized = normalize(fixturePath).replaceAll(sep, "/");
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) throw new Error("invalid_cli_args: --fixture must not traverse outside the repo");
  if (FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) throw new Error("invalid_cli_args: --fixture must not read ignored or live-only paths");
  if (!normalized.endsWith(".json")) throw new Error("invalid_cli_args: --fixture must be a JSON file");
}
function resolveFixtureReadPath(fixturePath: string): string { assertSafeFixturePath(fixturePath); return `${PROJECT_ROOT}/${normalize(fixturePath).replaceAll(sep, "/")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] { return [...new Set(values)].sort(); }
function boundIssues(issues: readonly string[]): readonly string[] { return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 240 ? `${issue.slice(0, 237)}...` : issue); }
function finalizeReport(report: M075S01Report, args: M075S01Args): M075S01Report {
  const allowBlockedPass = report.statusCode !== "m075_s01_live_source_blocked" || args.allowBlocked;
  return { ...report, success: allowBlockedPass && report.success, issues: boundIssues([...report.issues, ...(allowBlockedPass ? [] : ["source.available: blocked live source requires --allow-blocked"])]) };
}
function liveSourceUnavailable(generatedAt: string, args: M075S01Args, packageCheck: M075S01Check, issue: string): M075S01Report {
  return finalizeReport({ command: COMMAND_NAME, generatedAt, success: false, statusCode: "m075_s01_live_source_unavailable", failedCheckIds: ["source.available"], checks: [fail("source.available", "Live Log Analytics source is unavailable.", [issue]), packageCheck], observed: { ...EMPTY_OBSERVED, sourceAvailability: "unavailable", queryMetadata: { ...EMPTY_QUERY_METADATA, mode: "live", source: "azure-log-analytics" } }, issues: [`source.available: ${issue}`] }, args);
}
function buildDefaultLiveCollectors(): M075S01LiveCollectors {
  return hasLogEnv(process.env) ? {
    discoverWorkspaces: async () => resolveWorkspaceIds(process.env),
    queryLogs: async ({ workspaceIds, timespan, limit }) => queryReviewAuditLogs({ workspaceIds: [...workspaceIds], timespan, limit }),
  } : {};
}
function hasLogEnv(env: NodeJS.ProcessEnv): boolean { return splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_ID).length > 0 || splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_IDS).length > 0 || splitList(env.LOG_ANALYTICS_WORKSPACE_ID).length > 0 || splitList(env.LOG_ANALYTICS_WORKSPACE_IDS).length > 0 || Boolean(env.AZURE_RESOURCE_GROUP ?? env.ACA_RESOURCE_GROUP ?? env.RESOURCE_GROUP); }
async function resolveWorkspaceIds(env: NodeJS.ProcessEnv): Promise<string[]> {
  const explicit = [...splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_ID), ...splitList(env.AZURE_LOG_ANALYTICS_WORKSPACE_IDS), ...splitList(env.LOG_ANALYTICS_WORKSPACE_ID), ...splitList(env.LOG_ANALYTICS_WORKSPACE_IDS)];
  if (explicit.length > 0) return [...new Set(explicit)];
  const resourceGroup = env.AZURE_RESOURCE_GROUP ?? env.ACA_RESOURCE_GROUP ?? env.RESOURCE_GROUP;
  if (!resourceGroup) return [];
  return discoverLogAnalyticsWorkspaceIds({ resourceGroup });
}
function splitList(value: string | undefined): string[] { return value?.split(/[;,\s]+/).map((item) => item.trim()).filter(Boolean) ?? []; }
function compactError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(GITHUB_PRIVATE_KEY|GITHUB_PRIVATE_KEY_BASE64|github_pat_|ghp_|sk-)[^\s,;]*/gi, "$1[redacted]").slice(0, 180); }
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

export async function main(rawArgs = Bun.argv.slice(2), options: M075S01MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M075S01Args;
  try { args = parseM075S01Args(rawArgs); } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m075_s01_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) { stdout.write(HELP_TEXT); return 0; }
  const effectiveArgs = args.live || args.fixturePath ? args : { ...args, fixturePath: DEFAULT_FIXTURE_PATH };
  const report = await (options.evaluate ?? ((parsed) => evaluateM075S01Contract(parsed)))(effectiveArgs);
  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write([`${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`, `statusCode=${report.statusCode}`, `sourceAvailability=${report.observed.sourceAvailability} workspaces=${report.observed.workspaceCount}`, `windows=${report.observed.windowsPresent.join(",")}`, `rows=total:${report.observed.totalRows},malformed:${report.observed.malformedRows}`, `failedChecks=${report.failedCheckIds.join(",") || "none"}`, ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []), ""].join("\n"));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
