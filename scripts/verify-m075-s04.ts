import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMAND_NAME = "verify:m075:s04" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s04.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m075-s04-publication-reason-contract.json" as const;

export type M075S04StatusCode =
  | "m075_s04_ok"
  | "m075_s04_contract_failed"
  | "m075_s04_fixture_read_failed"
  | "m075_s04_invalid_json"
  | "m075_s04_malformed_evidence"
  | "m075_s04_invalid_arg";
export type M075S04CheckStatus = "pass" | "fail";
export type M075S04CheckId =
  | "fixture.shape"
  | "outcome-buckets.present"
  | "reason-evidence.non-empty"
  | "runtime-signals.present"
  | "publisher-sample.bounded"
  | "direct-fallback.disallowed"
  | "fallback-leakage.absent"
  | "redaction.safe"
  | "output.bounded"
  | "negative-controls.present"
  | "package-wiring.present";

export type M075S04Args = { readonly json: boolean; readonly help: boolean; readonly fixturePath?: string };
export type M075S04Check = { readonly id: M075S04CheckId; readonly status: M075S04CheckStatus; readonly message: string; readonly issues: readonly string[] };
export type M075S04Counts = Record<string, number>;
export type M075S04OutcomeKey = "published" | "skipped" | "blocked" | "failed" | "movedToDetails" | "fallbackDisallowed" | "degraded";
export type M075S04OutcomeBucket = { readonly mode: string; readonly count: number; readonly reasons: readonly string[] };
export type M075S04EvidenceSnapshot = {
  readonly schema: "m075-s04-publication-reason-contract.v1";
  readonly generatedAt: string;
  readonly provenance?: Record<string, unknown>;
  readonly runtime: {
    readonly gate: "review-candidate-publication";
    readonly gateResult: string;
    readonly mode: string;
    readonly counts: M075S04Counts;
    readonly outcomeBuckets: Record<M075S04OutcomeKey, M075S04OutcomeBucket>;
    readonly publisherResultSample: readonly Record<string, unknown>[];
    readonly redaction: Record<string, boolean>;
  };
  readonly logs: {
    readonly gate: "review-candidate-publication";
    readonly gateResult: string;
    readonly mode: string;
    readonly counts: M075S04Counts;
    readonly outcomeBuckets: Record<M075S04OutcomeKey, M075S04OutcomeBucket>;
  };
  readonly reviewDetails: {
    readonly sourceAvailable: boolean;
    readonly gate: "review-candidate-publication";
    readonly gateResult: string;
    readonly mode: string;
    readonly visibleBody: { readonly lineCount: number; readonly maxLineCount: number; readonly maxLineLength: number; readonly lines: readonly string[] };
    readonly outcomeBuckets: Record<M075S04OutcomeKey, M075S04OutcomeBucket>;
    readonly movedToDetails: { readonly redaction: Record<string, boolean>; readonly omittedRawPayloads: boolean };
  };
  readonly negativeControls: {
    readonly emptyReasonsRejected: boolean;
    readonly rawCanariesRejected: boolean;
    readonly directFallbackLeakageRejected: boolean;
    readonly unapprovedContentRejected: boolean;
    readonly unsafeRedactionFlagsRejected: boolean;
    readonly unboundedVisibleOutputRejected: boolean;
  };
};
export type M075S04Observed = {
  readonly bucketCount: number;
  readonly nonEmptyReasonBucketCount: number;
  readonly visibleLineCount: number;
  readonly publisherSampleCount: number;
  readonly directFallbackPublished: number;
  readonly fallbackDisallowed: number;
};
export type M075S04Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M075S04StatusCode;
  readonly fixturePath?: string;
  readonly failedCheckIds: readonly M075S04CheckId[];
  readonly checks: readonly M075S04Check[];
  readonly observed: M075S04Observed;
  readonly issues: readonly string[];
};
export type EvaluateM075S04Options = {
  readonly generatedAt?: string;
  readonly readFileText?: (path: string) => Promise<string>;
  readonly readPackageJsonText?: () => Promise<string>;
};
export type M075S04Writer = { readonly write: (chunk: string) => unknown };
export type M075S04MainOptions = { readonly stdout?: M075S04Writer; readonly stderr?: M075S04Writer; readonly evaluate?: (args: M075S04Args) => Promise<M075S04Report> };

const HELP_TEXT = `Usage: bun scripts/verify-m075-s04.ts [--fixture <path>] [--json] [--help]\n\nVerifies fixture-only candidate publication outcome reason evidence for S04. The verifier requires explicit safe mode buckets, non-empty sanitized reasons, bounded output, direct fallback denial, package wiring, and redaction-safe runtime/log/Review Details projections. Live mode is intentionally unsupported.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_FIXTURE_BYTES = 100_000;
const MAX_ISSUES = 24;
const MAX_REASON_CODES = 12;
const MAX_REASON_LENGTH = 80;
const MAX_VISIBLE_LINES = 24;
const MAX_VISIBLE_LINE_LENGTH = 180;
const MAX_PUBLISHER_SAMPLE = 20;
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const REQUIRED_OUTCOME_BUCKETS = ["published", "skipped", "blocked", "failed", "movedToDetails", "fallbackDisallowed", "degraded"] as const satisfies readonly M075S04OutcomeKey[];
const REQUIRED_REDACTION_FLAGS = [
  "rawCandidatePayloadsIncluded",
  "rawPromptsIncluded",
  "rawModelOutputIncluded",
  "diffsIncluded",
  "replacementTextIncluded",
  "githubResponsePayloadsIncluded",
  "secretLikeValuesIncluded",
] as const;
const FORBIDDEN_RAW_KEY = /(^|_)(raw(Log|Payload|Candidate|Prompt|Model|Diff)|raw_log|raw_payload|prompt|modelOutput|model_output|candidatePayload|candidateBody|diff|patch|hunk|fixReplacementText|replacementText|secret|token|apiKey|password)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|PROMPT_SECRET|TOKEN=|diff --git|unapproved content canary|sk-[a-z0-9]|ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SAFE_REASON = /^[a-z0-9][a-z0-9-]{1,79}$/;

const EMPTY_OBSERVED: M075S04Observed = { bucketCount: 0, nonEmptyReasonBucketCount: 0, visibleLineCount: 0, publisherSampleCount: 0, directFallbackPublished: 0, fallbackDisallowed: 0 };

export function parseM075S04Args(args: readonly string[]): M075S04Args {
  const parsed: Partial<M075S04Args> = { json: false, help: false };
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
    if (arg === "--live") throw new Error("invalid_cli_args: verify:m075:s04 is fixture-only");
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return parsed as M075S04Args;
}

export async function evaluateM075S04Contract(args: M075S04Args = parseM075S04Args(["--fixture", DEFAULT_FIXTURE_PATH]), options: EvaluateM075S04Options = {}): Promise<M075S04Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageText));
  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  let text: string;
  try {
    text = await (options.readFileText ?? ((path) => Bun.file(resolveFixtureReadPath(path)).text()))(fixturePath);
  } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s04_fixture_read_failed", [fail("fixture.shape", "Fixture could not be read.", ["Fixture path is missing or unreadable."]), packageCheck]);
  }
  if (text.length > MAX_FIXTURE_BYTES) {
    return reportFailure(generatedAt, fixturePath, "m075_s04_malformed_evidence", [fail("fixture.shape", "Fixture is larger than the verifier cap.", [`fixture bytes ${text.length} exceeds ${MAX_FIXTURE_BYTES}.`]), packageCheck]);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s04_invalid_json", [fail("fixture.shape", "Fixture JSON could not be parsed.", ["Fixture JSON could not be parsed."]), packageCheck]);
  }
  const snapshot = normalizeEvidenceSnapshot(parsed);
  if (!snapshot) {
    return reportFailure(generatedAt, fixturePath, "m075_s04_malformed_evidence", [fail("fixture.shape", "Evidence shape is malformed.", ["schema/runtime/logs/reviewDetails/negativeControls shape is missing or invalid."]), packageCheck]);
  }
  const evaluation = evaluateEvidence(snapshot, packageCheck);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s04_ok" : "m075_s04_contract_failed",
    fixturePath,
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))),
  };
}

export function evaluateEvidence(snapshot: M075S04EvidenceSnapshot, packageCheck: M075S04Check = packageWiringCheck(true)): { readonly checks: readonly M075S04Check[]; readonly observed: M075S04Observed } {
  const checks: M075S04Check[] = [pass("fixture.shape", "Evidence has the bounded S04 publication reason contract shape.")];
  const buckets = snapshot.runtime.outcomeBuckets;
  const visible = snapshot.reviewDetails.visibleBody;
  const observed: M075S04Observed = {
    bucketCount: Object.keys(buckets).length,
    nonEmptyReasonBucketCount: REQUIRED_OUTCOME_BUCKETS.filter((key) => reasonsFor(buckets[key]).length > 0).length,
    visibleLineCount: visible.lineCount,
    publisherSampleCount: snapshot.runtime.publisherResultSample.length,
    directFallbackPublished: count(snapshot.runtime.counts.directPublished) + count(snapshot.logs.counts.directPublished),
    fallbackDisallowed: count(snapshot.runtime.counts.fallbackDisallowed),
  };

  const bucketIssues = validateOutcomeBuckets(snapshot);
  checks.push(bucketIssues.length === 0 ? pass("outcome-buckets.present", "All required safe outcome mode buckets are present with positive evidence.") : fail("outcome-buckets.present", "Required outcome buckets are missing or incomplete.", bucketIssues));

  const reasonIssues = validateReasonEvidence(snapshot);
  checks.push(reasonIssues.length === 0 ? pass("reason-evidence.non-empty", "Every non-zero outcome bucket has non-empty sanitized reason evidence.") : fail("reason-evidence.non-empty", "Outcome reason evidence is empty, unsafe, or inconsistent.", reasonIssues));

  const runtimeIssues = validateRuntimeSignals(snapshot);
  checks.push(runtimeIssues.length === 0 ? pass("runtime-signals.present", "Runtime and structured log signals expose gate, gateResult/mode, counts, and buckets.") : fail("runtime-signals.present", "Runtime or log signals are missing required publication fields.", runtimeIssues));

  const sampleIssues = validatePublisherSample(snapshot);
  checks.push(sampleIssues.length === 0 ? pass("publisher-sample.bounded", "Publisher result sample is bounded and redaction-safe.") : fail("publisher-sample.bounded", "Publisher result sample is missing or unbounded.", sampleIssues));

  checks.push(observed.directFallbackPublished === 0 && count(snapshot.runtime.counts.directAttempted) === 0 && observed.fallbackDisallowed > 0
    ? pass("direct-fallback.disallowed", "Direct fallback publication is zero while fallback-disallowed evidence is explicit.")
    : fail("direct-fallback.disallowed", "Direct fallback leakage or missing fallback-disallowed evidence was observed.", [`directFallbackPublished=${observed.directFallbackPublished} directAttempted=${count(snapshot.runtime.counts.directAttempted)} fallbackDisallowed=${observed.fallbackDisallowed}`]));

  const leakageIssues = validateFallbackLeakage(snapshot);
  checks.push(leakageIssues.length === 0 ? pass("fallback-leakage.absent", "No direct fallback visible content or unapproved publication leakage is present.") : fail("fallback-leakage.absent", "Fallback or unapproved content leaked into visible evidence.", leakageIssues));

  const redactionIssues = validateRedaction(snapshot);
  checks.push(redactionIssues.length === 0 ? pass("redaction.safe", "Runtime/log/Review Details fixture excludes raw candidates, prompts, model output, diffs, replacements, GitHub payloads, and secrets.") : fail("redaction.safe", "Unsafe evidence reached the verifier surface.", redactionIssues));

  const boundIssuesFound = validateBounds(snapshot);
  checks.push(boundIssuesFound.length === 0 ? pass("output.bounded", "Visible output, reason arrays, fixture issues, and publisher samples remain bounded.") : fail("output.bounded", "Verifier-visible output exceeded bounds.", boundIssuesFound));

  const negativeIssues = validateNegativeControls(snapshot);
  checks.push(negativeIssues.length === 0 ? pass("negative-controls.present", "Fixture declares negative controls for empty reasons, raw canaries, fallback leakage, unapproved content, unsafe flags, and unbounded output.") : fail("negative-controls.present", "Required negative controls are absent.", negativeIssues));

  checks.push(packageCheck);
  return { checks, observed };
}

function normalizeEvidenceSnapshot(value: unknown): M075S04EvidenceSnapshot | null {
  if (!isRecord(value) || value.schema !== "m075-s04-publication-reason-contract.v1" || typeof value.generatedAt !== "string") return null;
  if (!isRecord(value.runtime) || !isRecord(value.logs) || !isRecord(value.reviewDetails) || !isRecord(value.negativeControls)) return null;
  const runtime = value.runtime;
  const logs = value.logs;
  const reviewDetails = value.reviewDetails;
  if (runtime.gate !== "review-candidate-publication" || logs.gate !== "review-candidate-publication" || reviewDetails.gate !== "review-candidate-publication") return null;
  if (!isRecord(runtime.counts) || !isRecord(runtime.outcomeBuckets) || !Array.isArray(runtime.publisherResultSample) || !isRecord(runtime.redaction)) return null;
  if (!isRecord(logs.counts) || !isRecord(logs.outcomeBuckets)) return null;
  if (!isRecord(reviewDetails.visibleBody) || !Array.isArray(reviewDetails.visibleBody.lines) || !isRecord(reviewDetails.outcomeBuckets) || !isRecord(reviewDetails.movedToDetails) || !isRecord(reviewDetails.movedToDetails.redaction)) return null;
  return value as M075S04EvidenceSnapshot;
}

function validateOutcomeBuckets(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  for (const surface of ["runtime", "logs", "reviewDetails"] as const) {
    const buckets = snapshot[surface].outcomeBuckets;
    for (const key of REQUIRED_OUTCOME_BUCKETS) {
      const bucket = buckets[key];
      if (!bucket) { issues.push(`${surface}.outcomeBuckets.${key} is missing.`); continue; }
      if (bucket.mode !== modeForBucket(key)) issues.push(`${surface}.outcomeBuckets.${key}.mode must be ${modeForBucket(key)}.`);
      if (count(bucket.count) <= 0) issues.push(`${surface}.outcomeBuckets.${key}.count must be positive.`);
    }
  }
  return boundIssues(issues) as string[];
}

function validateReasonEvidence(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  for (const surface of ["runtime", "logs", "reviewDetails"] as const) {
    for (const key of REQUIRED_OUTCOME_BUCKETS) {
      const bucket = snapshot[surface].outcomeBuckets[key];
      if (!bucket || count(bucket.count) <= 0) continue;
      const reasons = reasonsFor(bucket);
      if (reasons.length === 0) issues.push(`${surface}.outcomeBuckets.${key}.reasons must be non-empty.`);
      if (reasons.length > MAX_REASON_CODES) issues.push(`${surface}.outcomeBuckets.${key}.reasons exceeds ${MAX_REASON_CODES}.`);
      for (const reason of reasons) {
        if (reason.length > MAX_REASON_LENGTH || !SAFE_REASON.test(reason) || FORBIDDEN_RAW_VALUE.test(reason)) issues.push(`${surface}.outcomeBuckets.${key}.reasons contains unsafe reason token.`);
      }
    }
  }
  return boundIssues(issues) as string[];
}

function validateRuntimeSignals(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  if (snapshot.runtime.gateResult !== snapshot.runtime.mode) issues.push("runtime.gateResult must match runtime.mode.");
  if (snapshot.logs.gateResult !== snapshot.runtime.gateResult || snapshot.logs.mode !== snapshot.runtime.mode) issues.push("logs gateResult/mode must match runtime.");
  if (snapshot.reviewDetails.gateResult !== snapshot.runtime.gateResult || snapshot.reviewDetails.mode !== snapshot.runtime.mode) issues.push("Review Details gateResult/mode must match runtime.");
  for (const key of ["candidatePublished", "candidateSkipped", "candidateBlocked", "candidateFailed", "candidateMovedToDetails", "fallbackDisallowed", "malformed"] as const) {
    if (typeof snapshot.runtime.counts[key] !== "number") issues.push(`runtime.counts.${key} must be numeric.`);
    if (typeof snapshot.logs.counts[key] !== "number") issues.push(`logs.counts.${key} must be numeric.`);
  }
  return issues;
}

function validatePublisherSample(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const sample = snapshot.runtime.publisherResultSample;
  if (sample.length === 0) issues.push("runtime.publisherResultSample must be non-empty.");
  if (sample.length > MAX_PUBLISHER_SAMPLE) issues.push(`runtime.publisherResultSample length ${sample.length} exceeds ${MAX_PUBLISHER_SAMPLE}.`);
  sample.forEach((entry, index) => {
    const status = boundedString(entry.status, 32);
    const reason = boundedString(entry.reason, MAX_REASON_LENGTH);
    if (!status) issues.push(`runtime.publisherResultSample[${index}].status is missing.`);
    if (!reason || !SAFE_REASON.test(reason)) issues.push(`runtime.publisherResultSample[${index}].reason must be a sanitized reason token.`);
  });
  return boundIssues(issues) as string[];
}

function validateFallbackLeakage(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const lines = snapshot.reviewDetails.visibleBody.lines.join("\n");
  if (/direct fallback published|fallback body|unapproved content canary/i.test(lines)) issues.push("reviewDetails.visibleBody contains direct fallback or unapproved content marker.");
  if (count(snapshot.runtime.counts.directPublished) !== 0 || count(snapshot.logs.counts.directPublished) !== 0) issues.push("directPublished counts must be zero.");
  return issues;
}

function validateRedaction(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  for (const [surface, flags] of [["runtime.redaction", snapshot.runtime.redaction], ["reviewDetails.movedToDetails.redaction", snapshot.reviewDetails.movedToDetails.redaction]] as const) {
    for (const key of REQUIRED_REDACTION_FLAGS) {
      if (flags[key] !== false) issues.push(`${surface}.${key} must be false.`);
    }
    if (flags.bounded !== true) issues.push(`${surface}.bounded must be true.`);
  }
  if (snapshot.reviewDetails.movedToDetails.omittedRawPayloads !== true) issues.push("reviewDetails.movedToDetails.omittedRawPayloads must be true.");
  findForbiddenCanaryPaths(snapshot).forEach((path) => issues.push(`forbidden raw key/value at ${path}.`));
  return boundIssues(issues) as string[];
}

function validateBounds(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const visible = snapshot.reviewDetails.visibleBody;
  if (visible.maxLineCount > MAX_VISIBLE_LINES) issues.push(`maxLineCount ${visible.maxLineCount} exceeds verifier cap ${MAX_VISIBLE_LINES}.`);
  if (visible.maxLineLength > MAX_VISIBLE_LINE_LENGTH) issues.push(`maxLineLength ${visible.maxLineLength} exceeds verifier cap ${MAX_VISIBLE_LINE_LENGTH}.`);
  if (visible.lineCount !== visible.lines.length) issues.push(`lineCount ${visible.lineCount} does not match lines.length ${visible.lines.length}.`);
  if (visible.lines.length > visible.maxLineCount) issues.push(`visible lines ${visible.lines.length} exceeds fixture maxLineCount ${visible.maxLineCount}.`);
  visible.lines.forEach((line, index) => { if (line.length > visible.maxLineLength) issues.push(`visibleBody.lines[${index}] exceeds maxLineLength.`); });
  for (const surface of ["runtime", "logs", "reviewDetails"] as const) {
    for (const key of REQUIRED_OUTCOME_BUCKETS) {
      const reasons = reasonsFor(snapshot[surface].outcomeBuckets[key]);
      if (reasons.length > MAX_REASON_CODES) issues.push(`${surface}.outcomeBuckets.${key}.reasons exceeds reason cap.`);
    }
  }
  return boundIssues(issues) as string[];
}

function validateNegativeControls(snapshot: M075S04EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const controls = snapshot.negativeControls;
  for (const key of ["emptyReasonsRejected", "rawCanariesRejected", "directFallbackLeakageRejected", "unapprovedContentRejected", "unsafeRedactionFlagsRejected", "unboundedVisibleOutputRejected"] as const) {
    if (controls[key] !== true) issues.push(`negativeControls.${key} must be true.`);
  }
  return issues;
}

function modeForBucket(key: M075S04OutcomeKey): string {
  if (key === "movedToDetails") return "moved-to-details";
  if (key === "fallbackDisallowed") return "fallback-disallowed";
  return key;
}
function reasonsFor(bucket: M075S04OutcomeBucket | undefined): string[] { return Array.isArray(bucket?.reasons) ? bucket.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).map((reason) => reason.trim()) : []; }
function packageWiringCheck(packageWiringPresent: boolean): M075S04Check { return packageWiringPresent ? pass("package-wiring.present", "package.json exposes verify:m075:s04.") : fail("package-wiring.present", "package.json verify:m075:s04 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]); }
function reportFailure(generatedAt: string, fixturePath: string, statusCode: M075S04StatusCode, checks: readonly M075S04Check[]): M075S04Report { const failed = checks.filter((check) => check.status !== "pass"); return { command: COMMAND_NAME, generatedAt, success: false, statusCode, fixturePath, failedCheckIds: uniqueSorted(failed.map((check) => check.id)), checks, observed: EMPTY_OBSERVED, issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))) }; }
function pass(id: M075S04CheckId, message: string): M075S04Check { return { id, status: "pass", message, issues: [] }; }
function fail(id: M075S04CheckId, message: string, issues: readonly string[]): M075S04Check { return { id, status: "fail", message, issues: boundIssues(issues) }; }
function hasExpectedPackageScript(packageJsonText: string): boolean { try { const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> }; return parsed.scripts?.[COMMAND_NAME] === EXPECTED_PACKAGE_SCRIPT; } catch { return packageJsonText.includes(`"${COMMAND_NAME}": "${EXPECTED_PACKAGE_SCRIPT}"`) || packageJsonText.includes(`"${COMMAND_NAME}":"${EXPECTED_PACKAGE_SCRIPT}"`); } }
function assertSafeFixturePath(fixturePath: string): void { if (!fixturePath || isAbsolute(fixturePath)) throw new Error("invalid_cli_args: --fixture must be a repo-relative path"); const normalized = normalize(fixturePath).replaceAll(sep, "/"); if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) throw new Error("invalid_cli_args: --fixture must not traverse outside the repo"); if (FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) throw new Error("invalid_cli_args: --fixture must not read ignored or live-only paths"); if (!normalized.endsWith(".json")) throw new Error("invalid_cli_args: --fixture must be a JSON file"); }
function resolveFixtureReadPath(fixturePath: string): string { assertSafeFixturePath(fixturePath); return `${PROJECT_ROOT}/${normalize(fixturePath).replaceAll(sep, "/")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] { return [...new Set(values)].sort(); }
function boundIssues(issues: readonly string[]): readonly string[] { return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 240 ? `${issue.slice(0, 237)}...` : issue); }
function count(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; }
function boundedString(value: unknown, maxLength: number): string | null { if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null; const text = String(value).trim(); return text.length > 0 && text.length <= maxLength ? text : null; }
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

export async function main(rawArgs = Bun.argv.slice(2), options: M075S04MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M075S04Args;
  try { args = parseM075S04Args(rawArgs); } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m075_s04_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) { stdout.write(HELP_TEXT); return 0; }
  const effectiveArgs = args.fixturePath ? args : { ...args, fixturePath: DEFAULT_FIXTURE_PATH };
  const report = await (options.evaluate ?? ((parsed) => evaluateM075S04Contract(parsed)))(effectiveArgs);
  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write([`${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`, `statusCode=${report.statusCode}`, `buckets=${report.observed.bucketCount} reasonBuckets=${report.observed.nonEmptyReasonBucketCount}`, `publisherSample=${report.observed.publisherSampleCount}`, `directFallbackPublished=${report.observed.directFallbackPublished} fallbackDisallowed=${report.observed.fallbackDisallowed}`, `visibleLines=${report.observed.visibleLineCount}`, `failedChecks=${report.failedCheckIds.join(",") || "none"}`, ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []), ""].join("\n"));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
