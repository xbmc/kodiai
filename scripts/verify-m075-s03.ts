import { dirname, isAbsolute, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMAND_NAME = "verify:m075:s03" as const;
export const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s03.ts" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m075-s03-non-inlineable-review-details.json" as const;

export type M075S03StatusCode =
  | "m075_s03_ok"
  | "m075_s03_contract_failed"
  | "m075_s03_fixture_read_failed"
  | "m075_s03_invalid_json"
  | "m075_s03_malformed_evidence"
  | "m075_s03_invalid_arg";
export type M075S03CheckStatus = "pass" | "fail";
export type M075S03CheckId =
  | "fixture.shape"
  | "source.available"
  | "correlation.present"
  | "moved-to-details.present"
  | "direct-fallback.absent"
  | "fabricated-processed.absent"
  | "inline-publication.absent"
  | "reason.explicit"
  | "output.bounded"
  | "redaction.safe"
  | "failure-classification.separated"
  | "package-wiring.present";

export type M075S03Args = { readonly json: boolean; readonly help: boolean; readonly fixturePath?: string };
export type M075S03Check = { readonly id: M075S03CheckId; readonly status: M075S03CheckStatus; readonly message: string; readonly issues: readonly string[] };
export type M075S03Counts = Record<string, number>;
export type M075S03EvidenceSnapshot = {
  readonly schema: "m075-s03-non-inlineable-review-details.v1";
  readonly generatedAt: string;
  readonly provenance?: Record<string, unknown>;
  readonly reviewDetails: {
    readonly sourceAvailable: boolean;
    readonly published: boolean;
    readonly reviewOutputKey: string;
    readonly deliveryId: string;
    readonly correlation: {
      readonly repo: boolean;
      readonly pull: boolean;
      readonly reviewOutputKey: boolean;
      readonly deliveryId: boolean;
      readonly commit?: boolean;
    };
    readonly publicationMode: string;
    readonly surfaceKind: string;
    readonly visibleBody: {
      readonly lineCount: number;
      readonly maxLineCount: number;
      readonly maxLineLength: number;
      readonly lines: readonly string[];
    };
  };
  readonly candidatePublication: {
    readonly gateResult: string;
    readonly mode: string;
    readonly counts: M075S03Counts;
    readonly reasons: readonly string[];
    readonly movedToDetails: {
      readonly counts: M075S03Counts;
      readonly reasonCounts: Record<string, number>;
      readonly redaction: Record<string, boolean>;
    };
  };
  readonly fixEligibility: {
    readonly gateResult: string;
    readonly counts: M075S03Counts;
    readonly reasonCounts: Record<string, number>;
  };
  readonly flow: {
    readonly publishedCommentIds: readonly number[];
    readonly convertedProcessedFindingCount: number;
    readonly hasFabricatedProcessedFindings: boolean;
  };
  readonly negativeControls: {
    readonly genericPublicationFailure: {
      readonly gateResult: string;
      readonly mode: string;
      readonly counts: M075S03Counts;
      readonly reasons: readonly string[];
      readonly movedToDetailsPresent: boolean;
      readonly detailsProjectionPresent: boolean;
    };
  };
};
export type M075S03Observed = {
  readonly reviewDetailsAvailable: boolean;
  readonly reviewOutputKeyPresent: boolean;
  readonly deliveryIdPresent: boolean;
  readonly movedToDetails: number;
  readonly detailsOnlyFindings: number;
  readonly directFallback: number;
  readonly inlineCandidatePublished: number;
  readonly visibleLineCount: number;
  readonly genericFailureMode: string;
};
export type M075S03Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly success: boolean;
  readonly statusCode: M075S03StatusCode;
  readonly fixturePath?: string;
  readonly failedCheckIds: readonly M075S03CheckId[];
  readonly checks: readonly M075S03Check[];
  readonly observed: M075S03Observed;
  readonly issues: readonly string[];
};
export type EvaluateM075S03Options = {
  readonly generatedAt?: string;
  readonly readFileText?: (path: string) => Promise<string>;
  readonly readPackageJsonText?: () => Promise<string>;
};
export type M075S03Writer = { readonly write: (chunk: string) => unknown };
export type M075S03MainOptions = { readonly stdout?: M075S03Writer; readonly stderr?: M075S03Writer; readonly evaluate?: (args: M075S03Args) => Promise<M075S03Report> };

const HELP_TEXT = `Usage: bun scripts/verify-m075-s03.ts [--fixture <path>] [--json] [--help]\n\nVerifies bounded fixture evidence that non-commentable approved review candidates are preserved in Review Details without direct fallback, fabricated findings, raw payloads, or generic failure misclassification. This verifier is fixture-only.\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_ISSUES = 24;
const MAX_FIXTURE_BYTES = 80_000;
const MAX_VISIBLE_LINES = 20;
const MAX_VISIBLE_LINE_LENGTH = 180;
const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/", "live-only/"] as const;
const FORBIDDEN_RAW_KEY = /(^|_)(raw(Log|Payload|Candidate|Prompt|Model|Diff)|raw_log|raw_payload|prompt|modelOutput|model_output|candidatePayload|candidateBody|diff|patch|hunk|fixReplacementText|replacementText|secret|token|apiKey|password)$/i;
const FORBIDDEN_RAW_VALUE = /(RAW_PROMPT_CANARY|RAW_MODEL_OUTPUT_CANARY|CANDIDATE_BODY_CANARY|TOOL_PAYLOAD_CANARY|RAW_PAYLOAD_CANARY|SECRET_TOKEN_CANARY|DIFF_TEXT_CANARY|PROMPT_SECRET|TOKEN=abc123|diff --git|feature fixed safely|feature fixed on|sk-test-secret|ghp_|github_pat_|sk-[a-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const REQUIRED_REDACTION_FLAGS = [
  "rawCandidatePayloadsIncluded",
  "rawPromptsIncluded",
  "rawModelOutputIncluded",
  "diffsIncluded",
  "replacementTextIncluded",
  "githubResponsePayloadsIncluded",
  "secretLikeValuesIncluded",
] as const;

const EMPTY_OBSERVED: M075S03Observed = {
  reviewDetailsAvailable: false,
  reviewOutputKeyPresent: false,
  deliveryIdPresent: false,
  movedToDetails: 0,
  detailsOnlyFindings: 0,
  directFallback: 0,
  inlineCandidatePublished: 0,
  visibleLineCount: 0,
  genericFailureMode: "unknown",
};

export function parseM075S03Args(args: readonly string[]): M075S03Args {
  const parsed: Partial<M075S03Args> = { json: false, help: false };
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
    if (arg === "--live") throw new Error("invalid_cli_args: verify:m075:s03 is fixture-only");
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }
  return parsed as M075S03Args;
}

export async function evaluateM075S03Contract(args: M075S03Args = parseM075S03Args(["--fixture", DEFAULT_FIXTURE_PATH]), options: EvaluateM075S03Options = {}): Promise<M075S03Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packageText = await (options.readPackageJsonText ?? (() => Bun.file("package.json").text()))().catch(() => "{}");
  const packageCheck = packageWiringCheck(hasExpectedPackageScript(packageText));
  const fixturePath = args.fixturePath ?? DEFAULT_FIXTURE_PATH;
  let text: string;
  try {
    text = await (options.readFileText ?? ((path) => Bun.file(resolveFixtureReadPath(path)).text()))(fixturePath);
  } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s03_fixture_read_failed", [fail("fixture.shape", "Fixture could not be read.", ["Fixture path is missing or unreadable."]), packageCheck]);
  }
  if (text.length > MAX_FIXTURE_BYTES) {
    return reportFailure(generatedAt, fixturePath, "m075_s03_malformed_evidence", [fail("fixture.shape", "Fixture is larger than the verifier cap.", [`fixture bytes ${text.length} exceeds ${MAX_FIXTURE_BYTES}.`]), packageCheck]);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return reportFailure(generatedAt, fixturePath, "m075_s03_invalid_json", [fail("fixture.shape", "Fixture JSON could not be parsed.", ["Fixture JSON could not be parsed."]), packageCheck]);
  }
  const snapshot = normalizeEvidenceSnapshot(parsed);
  if (!snapshot) {
    return reportFailure(generatedAt, fixturePath, "m075_s03_malformed_evidence", [fail("fixture.shape", "Evidence shape is malformed.", ["schema/reviewDetails/candidatePublication shape is missing or invalid."]), packageCheck]);
  }

  const evaluation = evaluateEvidence(snapshot, packageCheck);
  const failed = evaluation.checks.filter((check) => check.status !== "pass");
  return {
    command: COMMAND_NAME,
    generatedAt,
    success: failed.length === 0,
    statusCode: failed.length === 0 ? "m075_s03_ok" : "m075_s03_contract_failed",
    fixturePath,
    failedCheckIds: uniqueSorted(failed.map((check) => check.id)),
    checks: evaluation.checks,
    observed: evaluation.observed,
    issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))),
  };
}

export function evaluateEvidence(snapshot: M075S03EvidenceSnapshot, packageCheck: M075S03Check = packageWiringCheck(true)): { readonly checks: readonly M075S03Check[]; readonly observed: M075S03Observed } {
  const checks: M075S03Check[] = [pass("fixture.shape", "Evidence has the bounded S03 Review Details preservation shape.")];
  const counts = snapshot.candidatePublication.counts;
  const moved = snapshot.candidatePublication.movedToDetails;
  const visible = snapshot.reviewDetails.visibleBody;
  const generic = snapshot.negativeControls.genericPublicationFailure;
  const observed: M075S03Observed = {
    reviewDetailsAvailable: snapshot.reviewDetails.sourceAvailable && snapshot.reviewDetails.published,
    reviewOutputKeyPresent: Boolean(snapshot.reviewDetails.reviewOutputKey.trim()),
    deliveryIdPresent: Boolean(snapshot.reviewDetails.deliveryId.trim()),
    movedToDetails: count(counts.candidateMovedToDetails) || count(moved.counts.total),
    detailsOnlyFindings: count(counts.candidateDetailsOnlyFindings),
    directFallback: Math.max(count(counts.directPublished), count(counts.fallbackEvidence), count(counts.directAttempted)),
    inlineCandidatePublished: Math.max(count(counts.candidatePublished), snapshot.flow.publishedCommentIds.length),
    visibleLineCount: visible.lineCount,
    genericFailureMode: generic.mode,
  };

  checks.push(observed.reviewDetailsAvailable && snapshot.reviewDetails.publicationMode === "canonical" && snapshot.reviewDetails.surfaceKind === "issue_comment"
    ? pass("source.available", "Review Details source is available as a canonical issue-comment projection.")
    : fail("source.available", "Review Details source is unavailable or not canonical.", [`sourceAvailable=${snapshot.reviewDetails.sourceAvailable} published=${snapshot.reviewDetails.published} mode=${snapshot.reviewDetails.publicationMode} surface=${snapshot.reviewDetails.surfaceKind}`]));

  const correlationIssues = validateCorrelation(snapshot);
  checks.push(correlationIssues.length === 0 ? pass("correlation.present", "reviewOutputKey, deliveryId, and correlation metadata are present.") : fail("correlation.present", "Required correlation metadata is missing.", correlationIssues));

  checks.push(snapshot.candidatePublication.gateResult === "moved-to-details" && snapshot.candidatePublication.mode === "moved-to-details" && observed.movedToDetails > 0 && observed.detailsOnlyFindings > 0
    ? pass("moved-to-details.present", "At least one approved non-commentable finding was moved to Review Details.")
    : fail("moved-to-details.present", "Moved-to-details preservation evidence is missing.", [`gateResult=${snapshot.candidatePublication.gateResult} mode=${snapshot.candidatePublication.mode} moved=${observed.movedToDetails} detailsOnly=${observed.detailsOnlyFindings}`]));

  checks.push(observed.directFallback === 0
    ? pass("direct-fallback.absent", "Direct issue-comment fallback evidence is absent.")
    : fail("direct-fallback.absent", "Direct fallback evidence must remain zero.", [`directFallback=${observed.directFallback}`]));

  checks.push(snapshot.flow.hasFabricatedProcessedFindings === false && snapshot.flow.convertedProcessedFindingCount === 0 && count(counts.convertedProcessedFindings) === 0
    ? pass("fabricated-processed.absent", "No fabricated processed findings were recorded.")
    : fail("fabricated-processed.absent", "Fabricated or converted processed finding evidence is present.", [`hasFabricated=${snapshot.flow.hasFabricatedProcessedFindings} flowConverted=${snapshot.flow.convertedProcessedFindingCount} countConverted=${count(counts.convertedProcessedFindings)}`]));

  checks.push(observed.inlineCandidatePublished === 0 && count(counts.candidatePublishable) === 0
    ? pass("inline-publication.absent", "Inline candidate publication count is zero for the non-commentable case.")
    : fail("inline-publication.absent", "Non-commentable fixture must not publish inline candidate comments.", [`inlinePublished=${observed.inlineCandidatePublished} candidatePublishable=${count(counts.candidatePublishable)}`]));

  const reasonIssues = validateReasons(snapshot);
  checks.push(reasonIssues.length === 0 ? pass("reason.explicit", "Moved-to-details reason is explicit and matches fix-eligibility evidence.") : fail("reason.explicit", "Moved-to-details reason evidence is incomplete.", reasonIssues));

  const boundsIssues = validateBounds(snapshot);
  checks.push(boundsIssues.length === 0 ? pass("output.bounded", "Visible Review Details output is bounded by fixture caps.") : fail("output.bounded", "Visible Review Details output exceeded bounds.", boundsIssues));

  const redactionIssues = validateRedaction(snapshot);
  checks.push(redactionIssues.length === 0 ? pass("redaction.safe", "Fixture excludes raw candidates, prompts, model output, diffs, replacements, and secrets.") : fail("redaction.safe", "Unsafe evidence reached the verifier surface.", redactionIssues));

  const separationIssues = validateGenericFailureSeparation(snapshot);
  checks.push(separationIssues.length === 0 ? pass("failure-classification.separated", "Generic publication failures are not misclassified as moved-to-details.") : fail("failure-classification.separated", "Generic publication failure evidence was misclassified.", separationIssues));

  checks.push(packageCheck);
  return { checks, observed };
}

function normalizeEvidenceSnapshot(value: unknown): M075S03EvidenceSnapshot | null {
  if (!isRecord(value) || value.schema !== "m075-s03-non-inlineable-review-details.v1" || typeof value.generatedAt !== "string") return null;
  if (!isRecord(value.reviewDetails) || !isRecord(value.candidatePublication) || !isRecord(value.fixEligibility) || !isRecord(value.flow) || !isRecord(value.negativeControls)) return null;
  const reviewDetails = value.reviewDetails;
  const candidatePublication = value.candidatePublication;
  const fixEligibility = value.fixEligibility;
  const flow = value.flow;
  const negativeControls = value.negativeControls;
  if (!isRecord(reviewDetails.correlation) || !isRecord(reviewDetails.visibleBody)) return null;
  if (!isRecord(candidatePublication.counts) || !Array.isArray(candidatePublication.reasons) || !isRecord(candidatePublication.movedToDetails)) return null;
  if (!isRecord(candidatePublication.movedToDetails.counts) || !isRecord(candidatePublication.movedToDetails.reasonCounts) || !isRecord(candidatePublication.movedToDetails.redaction)) return null;
  if (!isRecord(fixEligibility.counts) || !isRecord(fixEligibility.reasonCounts)) return null;
  if (!Array.isArray(flow.publishedCommentIds)) return null;
  if (!isRecord(negativeControls.genericPublicationFailure)) return null;
  const generic = negativeControls.genericPublicationFailure;
  if (!isRecord(generic.counts) || !Array.isArray(generic.reasons)) return null;
  if (!Array.isArray(reviewDetails.visibleBody.lines)) return null;
  return value as M075S03EvidenceSnapshot;
}

function validateCorrelation(snapshot: M075S03EvidenceSnapshot): string[] {
  const issues: string[] = [];
  if (!snapshot.reviewDetails.reviewOutputKey.trim()) issues.push("reviewOutputKey is missing.");
  if (!snapshot.reviewDetails.deliveryId.trim()) issues.push("deliveryId is missing.");
  for (const key of ["repo", "pull", "reviewOutputKey", "deliveryId"] as const) {
    if (snapshot.reviewDetails.correlation[key] !== true) issues.push(`correlation.${key} must be true.`);
  }
  return issues;
}

function validateReasons(snapshot: M075S03EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const reasons = new Set(snapshot.candidatePublication.reasons);
  if (!reasons.has("candidate-moved-to-details")) issues.push("candidatePublication.reasons must include candidate-moved-to-details.");
  if (count(snapshot.candidatePublication.movedToDetails.reasonCounts["line-not-commentable"]) <= 0) issues.push("movedToDetails.reasonCounts.line-not-commentable must be positive.");
  if (count(snapshot.fixEligibility.reasonCounts["line-not-commentable"]) <= 0) issues.push("fixEligibility.reasonCounts.line-not-commentable must be positive.");
  if (!snapshot.reviewDetails.visibleBody.lines.some((line) => line.includes("reason=line-not-commentable"))) issues.push("visible Review Details lines must include reason=line-not-commentable.");
  return issues;
}

function validateBounds(snapshot: M075S03EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const visible = snapshot.reviewDetails.visibleBody;
  if (visible.maxLineCount > MAX_VISIBLE_LINES) issues.push(`maxLineCount ${visible.maxLineCount} exceeds verifier cap ${MAX_VISIBLE_LINES}.`);
  if (visible.maxLineLength > MAX_VISIBLE_LINE_LENGTH) issues.push(`maxLineLength ${visible.maxLineLength} exceeds verifier cap ${MAX_VISIBLE_LINE_LENGTH}.`);
  if (visible.lineCount !== visible.lines.length) issues.push(`lineCount ${visible.lineCount} does not match lines.length ${visible.lines.length}.`);
  if (visible.lines.length > visible.maxLineCount) issues.push(`visible lines ${visible.lines.length} exceeds fixture maxLineCount ${visible.maxLineCount}.`);
  for (const [index, line] of visible.lines.entries()) {
    if (line.length > visible.maxLineLength) issues.push(`visibleBody.lines[${index}] exceeds maxLineLength.`);
  }
  return boundIssues(issues) as string[];
}

function validateRedaction(snapshot: M075S03EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const redaction = snapshot.candidatePublication.movedToDetails.redaction;
  for (const key of REQUIRED_REDACTION_FLAGS) {
    if (redaction[key] !== false) issues.push(`movedToDetails.redaction.${key} must be false.`);
  }
  if (redaction.bounded !== true) issues.push("movedToDetails.redaction.bounded must be true.");
  findForbiddenCanaryPaths(snapshot).forEach((path) => issues.push(`forbidden raw key/value at ${path}.`));
  return boundIssues(issues) as string[];
}

function validateGenericFailureSeparation(snapshot: M075S03EvidenceSnapshot): string[] {
  const issues: string[] = [];
  const generic = snapshot.negativeControls.genericPublicationFailure;
  if (generic.gateResult === "moved-to-details" || generic.mode === "moved-to-details") issues.push("generic failure must not have moved-to-details gateResult/mode.");
  if (count(generic.counts.candidateFailed) <= 0) issues.push("generic failure control must include candidateFailed > 0.");
  if (count(generic.counts.candidateMovedToDetails) !== 0) issues.push("generic failure candidateMovedToDetails must be zero.");
  if (generic.movedToDetailsPresent !== false) issues.push("generic failure movedToDetailsPresent must be false.");
  if (generic.detailsProjectionPresent !== false) issues.push("generic failure detailsProjectionPresent must be false.");
  if (!generic.reasons.includes("candidate-publisher-failed")) issues.push("generic failure reasons must include candidate-publisher-failed.");
  return issues;
}

function packageWiringCheck(packageWiringPresent: boolean): M075S03Check {
  return packageWiringPresent ? pass("package-wiring.present", "package.json exposes verify:m075:s03.") : fail("package-wiring.present", "package.json verify:m075:s03 wiring is absent or drifted.", [`expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`]);
}
function reportFailure(generatedAt: string, fixturePath: string, statusCode: M075S03StatusCode, checks: readonly M075S03Check[]): M075S03Report {
  const failed = checks.filter((check) => check.status !== "pass");
  return { command: COMMAND_NAME, generatedAt, success: false, statusCode, fixturePath, failedCheckIds: uniqueSorted(failed.map((check) => check.id)), checks, observed: EMPTY_OBSERVED, issues: boundIssues(failed.flatMap((check) => check.issues.map((issue) => `${check.id}: ${issue}`))) };
}
function pass(id: M075S03CheckId, message: string): M075S03Check { return { id, status: "pass", message, issues: [] }; }
function fail(id: M075S03CheckId, message: string, issues: readonly string[]): M075S03Check { return { id, status: "fail", message, issues: boundIssues(issues) }; }
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
function count(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; }
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

export async function main(rawArgs = Bun.argv.slice(2), options: M075S03MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let args: M075S03Args;
  try { args = parseM075S03Args(rawArgs); } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    stderr.write(`${JSON.stringify({ command: COMMAND_NAME, success: false, statusCode: "m075_s03_invalid_arg", issues: [message] }, null, 2)}\n`);
    return 2;
  }
  if (args.help) { stdout.write(HELP_TEXT); return 0; }
  const effectiveArgs = args.fixturePath ? args : { ...args, fixturePath: DEFAULT_FIXTURE_PATH };
  const report = await (options.evaluate ?? ((parsed) => evaluateM075S03Contract(parsed)))(effectiveArgs);
  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write([`${COMMAND_NAME}: ${report.success ? "PASS" : "FAIL"}`, `statusCode=${report.statusCode}`, `reviewDetailsAvailable=${report.observed.reviewDetailsAvailable}`, `correlation=reviewOutputKey:${report.observed.reviewOutputKeyPresent ? "y" : "n"},deliveryId:${report.observed.deliveryIdPresent ? "y" : "n"}`, `movedToDetails=${report.observed.movedToDetails} detailsOnly=${report.observed.detailsOnlyFindings}`, `directFallback=${report.observed.directFallback} inlinePublished=${report.observed.inlineCandidatePublished}`, `visibleLines=${report.observed.visibleLineCount}`, `failedChecks=${report.failedCheckIds.join(",") || "none"}`, ...(report.issues.length > 0 ? [`issues=${report.issues.join("; ")}`] : []), ""].join("\n"));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
