import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMAND_NAME = "verify:m073:s07" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m073-s07-remediation.json";

export const S07_CHECK_IDS = [
  "fixture.shape",
  "s01-s02-linkage.cross-checked",
  "r131-disposition.explicit",
  "s06-proof-compatible",
  "redaction.safe",
  "negative-cases.covered",
] as const;

export type M073S07CheckId = typeof S07_CHECK_IDS[number];
export type M073S07CheckStatus = "pass" | "fail";
export type R131DispositionStatus = "bounded-evidence-present" | "formally-rescoped";
export type M073S07StatusCode =
  | "m073_s07_ok"
  | "m073_s07_remediation_failed"
  | "m073_s07_invalid_json"
  | "m073_s07_fixture_read_failed"
  | "m073_s07_invalid_arg";

export type M073S07Check = {
  readonly id: M073S07CheckId;
  readonly status: M073S07CheckStatus;
  readonly message: string;
  readonly issues: readonly string[];
};

export type M073S07ObservedTotals = {
  readonly s01BaselineRowCount: number;
  readonly s02ObservationCount: number;
  readonly s02SectionCount: number;
  readonly s02LinkedSectionCount: number;
  readonly s02NewSectionCount: number;
  readonly s02BypassedSectionCount: number;
  readonly matchedLinkCount: number;
  readonly unmatchedLinkCount: number;
  readonly s06S02SectionCount: number;
  readonly negativeCaseCount: number;
  readonly r131DispositionStatus: R131DispositionStatus | "missing" | "invalid";
  readonly m073PublishesSpecialistLaneOutputs: boolean | null;
};

export type M073S07Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly overallPassed: boolean;
  readonly statusCode: M073S07StatusCode;
  readonly failedCheckIds: readonly M073S07CheckId[];
  readonly checks: readonly M073S07Check[];
  readonly observedTotals: M073S07ObservedTotals;
  readonly issues: readonly string[];
};

export type M073S07Args = {
  readonly fixturePath: string;
  readonly json: boolean;
  readonly help: boolean;
};

export type M073S07Writer = {
  readonly write: (chunk: string) => unknown;
};

export type M073S07MainOptions = {
  readonly stdout?: M073S07Writer;
  readonly stderr?: M073S07Writer;
  readonly evaluate?: (fixturePath: string) => Promise<M073S07Report>;
};

export type EvaluateM073S07Options = {
  readonly generatedAt?: string;
  readonly readFixtureText?: (fixturePath: string) => Promise<string>;
};

type LoadedJson =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly kind: "read" | "json"; readonly path: string };

type S01BaselineSectionRow = {
  readonly sourceFixturePath: string;
  readonly sourceId: string;
  readonly caseId: string;
  readonly deliveryId: string;
  readonly promptKind: string;
  readonly sectionName: string;
  readonly baselineChars: number;
  readonly baselineEstimatedTokens: number;
};

type S02SectionRow = {
  readonly observationIndex: number;
  readonly sectionIndex: number;
  readonly caseId: string;
  readonly deliveryId: string;
  readonly promptKind: string;
  readonly sectionName: string;
  readonly budgetStatus: string;
  readonly includedChars: number;
  readonly includedTokens: number;
  readonly baselineSource: Record<string, unknown> | undefined;
};

const HELP_TEXT = `Usage: bun scripts/verify-m073-s07.ts [--fixture <path>] [--json] [--help]\n\nVerifies M073/S07 remediation evidence: S01/S02 baseline linkage, S06 compatibility, and R131 disposition.\n\nOptions:\n  --fixture <path>  Local JSON fixture path (default: ${DEFAULT_FIXTURE_PATH})\n  --json            Emit machine-readable JSON only\n  --help, -h        Show this help\n`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(SCRIPT_DIR);
const MAX_ISSUES = 20;
const MAX_BOUNDED_STRING_LENGTH = 220;
const ALLOWED_R131_STATUSES = new Set<R131DispositionStatus>(["bounded-evidence-present", "formally-rescoped"]);
const NON_COMPLETION_PATTERN = /\b(not complete|not completed|non-completion|not claimed complete|deferred|rescoped|re-scoped)\b/i;
const COMPLETION_CLAIM_PATTERN = /\b(R131\s+)?(is\s+)?(complete|completed|satisfied|closed|done)\b/i;
const FORBIDDEN_RAW_KEYS = /(^|_)(rawPrompt|promptText|prompt|diff|diffHunk|hunk|patch|comment|commentBody|body|candidate|candidateText|candidatePayload|modelOutput|completion|content|text|includedText|trimmedText|sectionText|retrievalText|retrievalChunk|retrievalChunks|chunkText|checkpointText|cacheKey|fingerprint|rawFingerprint|fingerprintHash|promptHash|diffHash|embedding|embeddingVector|vector|token|apiKey|secret)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function parseM073S07Args(args: readonly string[]): M073S07Args {
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

export async function evaluateM073S07Fixture(fixturePath = DEFAULT_FIXTURE_PATH, options: EvaluateM073S07Options = {}): Promise<M073S07Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readFixtureText = options.readFixtureText ?? ((path: string) => Bun.file(path).text());
  const resolvedFixturePath = resolveDefaultPath(fixturePath);

  let fixtureText: string;
  try {
    fixtureText = await readFixtureText(resolvedFixturePath);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s07_fixture_read_failed",
      checkId: "fixture.shape",
      message: "Fixture could not be read.",
      issues: [`S07 fixture path is missing or unreadable: ${fixturePath}`],
    });
  }

  let fixture: unknown;
  try {
    fixture = JSON.parse(fixtureText);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s07_invalid_json",
      checkId: "fixture.shape",
      message: "Fixture JSON could not be parsed.",
      issues: ["S07 fixture must be valid JSON."],
    });
  }

  const report = await evaluateRemediationFixture(fixture, { fixturePath, generatedAt, readFixtureText });
  return report;
}

export async function main(args = Bun.argv.slice(2), options: M073S07MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (chunk: string) => process.stdout.write(chunk) };
  const stderr = options.stderr ?? { write: (chunk: string) => process.stderr.write(chunk) };

  let parsed: M073S07Args;
  try {
    parsed = parseM073S07Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    const report = buildFailureReport({
      generatedAt: new Date().toISOString(),
      fixturePath: DEFAULT_FIXTURE_PATH,
      statusCode: "m073_s07_invalid_arg",
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

  const evaluate = options.evaluate ?? ((path: string) => evaluateM073S07Fixture(path));
  const report = await evaluate(parsed.fixturePath);
  writeReport(report, { json: parsed.json, stdout, stderr });
  return report.overallPassed ? 0 : 1;
}

async function evaluateRemediationFixture(fixture: unknown, options: {
  readonly fixturePath: string;
  readonly generatedAt: string;
  readonly readFixtureText: (fixturePath: string) => Promise<string>;
}): Promise<M073S07Report> {
  const shapeIssues = validateShape(fixture);
  const redactionIssues = validateRedaction(fixture);
  const paths = readEvidencePaths(fixture);

  const s01Loaded = paths.s01FixturePath ? await loadJson(paths.s01FixturePath, options.readFixtureText) : missingPath("evidencePaths.s01FixturePath");
  const s02Loaded = paths.s02FixturePath ? await loadJson(paths.s02FixturePath, options.readFixtureText) : missingPath("evidencePaths.s02FixturePath");
  const s06Loaded = paths.s06FixturePath ? await loadJson(paths.s06FixturePath, options.readFixtureText) : missingPath("evidencePaths.s06FixturePath");

  const s01Rows = s01Loaded.ok ? readS01Rows(s01Loaded.value, paths.s01FixturePath ?? "") : [];
  const s02Rows = s02Loaded.ok ? readS02Rows(s02Loaded.value) : [];
  const checks: M073S07Check[] = [];

  const fixtureShapeIssues = [
    ...shapeIssues,
    ...loadedIssues("S01 fixture", s01Loaded),
    ...loadedIssues("S02 fixture", s02Loaded),
    ...loadedIssues("S06 fixture", s06Loaded),
  ];
  checks.push(fixtureShapeIssues.length === 0
    ? pass("fixture.shape", "S07 fixture declares readable S01/S02/S06 evidence paths and remediation fields.")
    : fail("fixture.shape", "S07 fixture shape or declared evidence paths are invalid.", fixtureShapeIssues));

  const linkageIssues = s01Loaded.ok && s02Loaded.ok
    ? validateS01S02Linkage(s02Rows, s01Rows, paths.s01FixturePath ?? "")
    : ["S01/S02 linkage cannot be cross-checked until declared fixture paths are readable JSON."];
  checks.push(linkageIssues.length === 0
    ? pass("s01-s02-linkage.cross-checked", "Every S02 s01-baseline link matches a bounded S01 prompt section row.")
    : fail("s01-s02-linkage.cross-checked", "S02 baselineSource references do not fully match S01 prompt section rows.", linkageIssues));

  const dispositionIssues = validateR131Disposition(fixture);
  checks.push(dispositionIssues.length === 0
    ? pass("r131-disposition.explicit", "R131 disposition is explicit, bounded, and does not claim accidental completion.")
    : fail("r131-disposition.explicit", "R131 disposition is missing, incomplete, or falsely claims completion.", dispositionIssues));

  const s06Issues = s02Loaded.ok && s06Loaded.ok
    ? validateS06Compatibility(s02Loaded.value, s06Loaded.value, fixture)
    : ["S06 compatibility cannot be cross-checked until declared S02/S06 fixture paths are readable JSON."];
  checks.push(s06Issues.length === 0
    ? pass("s06-proof-compatible", "S06 proof remains compatible with S07 S02 linkage and non-public R131 disposition.")
    : fail("s06-proof-compatible", "S06 proof is missing or incompatible with S07 remediation evidence.", s06Issues));

  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "S07 fixture is bounded and contains no raw payload or secret-like fields/values.")
    : fail("redaction.safe", "S07 fixture contains unsafe field names, values, or unbounded strings.", redactionIssues));

  const negativeIssues = validateNegativeCases(fixture);
  checks.push(negativeIssues.length === 0
    ? pass("negative-cases.covered", "S07 fixture declares bounded negative coverage for linkage, disposition, and redaction failures.")
    : fail("negative-cases.covered", "S07 fixture negative-case coverage is missing or incomplete.", negativeIssues));

  const failedChecks = checks.filter((check) => check.status === "fail");
  const issues = boundIssues(failedChecks.flatMap((check) => check.issues.length > 0 ? check.issues : [check.message]));

  return {
    command: COMMAND_NAME,
    generatedAt: options.generatedAt,
    fixturePath: options.fixturePath,
    overallPassed: failedChecks.length === 0,
    statusCode: failedChecks.length === 0 ? "m073_s07_ok" : "m073_s07_remediation_failed",
    failedCheckIds: uniqueSorted(failedChecks.map((check) => check.id)),
    checks,
    observedTotals: buildObservedTotals(fixture, s01Rows, s02Rows, s06Loaded.ok ? s06Loaded.value : undefined),
    issues,
  };
}

function resolveDefaultPath(fixturePath: string): string {
  if (fixturePath !== DEFAULT_FIXTURE_PATH) return fixturePath;
  if (existsSync(fixturePath)) return fixturePath;
  return join(PROJECT_ROOT, fixturePath);
}

async function loadJson(path: string, readFixtureText: (fixturePath: string) => Promise<string>): Promise<LoadedJson> {
  let text: string;
  try {
    text = await readFixtureText(path);
  } catch {
    return { ok: false, kind: "read", path };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "json", path };
  }
}

function missingPath(path: string): LoadedJson {
  return { ok: false, kind: "read", path };
}

function loadedIssues(label: string, loaded: LoadedJson): string[] {
  if (loaded.ok) return [];
  if (loaded.kind === "json") return [`${label} is invalid JSON: ${loaded.path}`];
  return [`${label} path is missing or unreadable: ${loaded.path}`];
}

function validateShape(fixture: unknown): string[] {
  if (!isRecord(fixture)) return ["Fixture root must be an object."];
  const issues: string[] = [];
  if (!isRecord(fixture.evidencePaths)) issues.push("evidencePaths object is required.");
  for (const key of ["s01FixturePath", "s02FixturePath", "s06FixturePath"] as const) {
    if (!isRecord(fixture.evidencePaths) || !isNonEmptyString(fixture.evidencePaths[key])) issues.push(`evidencePaths.${key} is required.`);
  }
  if (!isRecord(fixture.r131Disposition)) issues.push("r131Disposition object is required.");
  if (fixture.negativeCoverage !== undefined && !Array.isArray(fixture.negativeCoverage)) issues.push("negativeCoverage must be an array when present.");
  return issues;
}

function readEvidencePaths(fixture: unknown): { s01FixturePath?: string; s02FixturePath?: string; s06FixturePath?: string } {
  if (!isRecord(fixture) || !isRecord(fixture.evidencePaths)) return {};
  return {
    s01FixturePath: isNonEmptyString(fixture.evidencePaths.s01FixturePath) ? fixture.evidencePaths.s01FixturePath : undefined,
    s02FixturePath: isNonEmptyString(fixture.evidencePaths.s02FixturePath) ? fixture.evidencePaths.s02FixturePath : undefined,
    s06FixturePath: isNonEmptyString(fixture.evidencePaths.s06FixturePath) ? fixture.evidencePaths.s06FixturePath : undefined,
  };
}

function readS01Rows(fixture: unknown, sourceFixturePath: string): S01BaselineSectionRow[] {
  if (!isRecord(fixture) || !Array.isArray(fixture.promptSections)) return [];
  const rows: S01BaselineSectionRow[] = [];
  fixture.promptSections.filter(isRecord).forEach((promptSection) => {
    if (!isNonEmptyString(promptSection.caseId) || !isNonEmptyString(promptSection.deliveryId) || !isNonEmptyString(promptSection.promptKind) || !Array.isArray(promptSection.sections)) return;
    promptSection.sections.filter(isRecord).forEach((section) => {
      if (!isNonEmptyString(section.sectionName) || !isFiniteNonNegativeInteger(section.charCount) || !isFiniteNonNegativeInteger(section.estimatedTokens)) return;
      rows.push({
        sourceFixturePath,
        sourceId: `${promptSection.caseId}:${promptSection.deliveryId}:${promptSection.promptKind}:${section.sectionName}`,
        caseId: promptSection.caseId,
        deliveryId: promptSection.deliveryId,
        promptKind: promptSection.promptKind,
        sectionName: section.sectionName,
        baselineChars: section.charCount,
        baselineEstimatedTokens: section.estimatedTokens,
      });
    });
  });
  return rows;
}

function readS02Rows(fixture: unknown): S02SectionRow[] {
  if (!isRecord(fixture) || !Array.isArray(fixture.promptBudgetEvidence)) return [];
  const rows: S02SectionRow[] = [];
  fixture.promptBudgetEvidence.filter(isRecord).forEach((observation, observationIndex) => {
    const sections = Array.isArray(observation.sections) ? observation.sections.filter(isRecord) : [];
    sections.forEach((section, sectionIndex) => {
      rows.push({
        observationIndex,
        sectionIndex,
        caseId: stringValue(observation.caseId),
        deliveryId: stringValue(observation.deliveryId),
        promptKind: stringValue(observation.promptKind),
        sectionName: stringValue(section.sectionName),
        budgetStatus: stringValue(section.budgetStatus),
        includedChars: numberValue(section.includedChars, -1),
        includedTokens: numberValue(section.includedTokens, -1),
        baselineSource: isRecord(section.baselineSource) ? section.baselineSource : undefined,
      });
    });
  });
  return rows;
}

function validateS01S02Linkage(s02Rows: readonly S02SectionRow[], s01Rows: readonly S01BaselineSectionRow[], s01FixturePath: string): string[] {
  const issues: string[] = [];
  if (s01Rows.length === 0) issues.push(`S01 fixture has no prompt section rows: ${s01FixturePath}`);
  if (s02Rows.length === 0) issues.push("S02 fixture has no prompt budget section rows.");
  let linked = 0;
  for (const row of s02Rows) {
    const prefix = `promptBudgetEvidence[${row.observationIndex}].sections[${row.sectionIndex}].baselineSource`;
    const source = row.baselineSource;
    if (!source) {
      issues.push(`${prefix} is required.`);
      continue;
    }
    const reason = source.reason;
    if (reason === "new-budget-section") {
      if (source.sourceFixturePath !== undefined || source.sourceId !== undefined || source.baselineChars !== undefined || source.baselineEstimatedTokens !== undefined) {
        issues.push(`${prefix} new-budget-section must not claim S01 fixture ids or baseline counts.`);
      }
      continue;
    }
    if (reason !== "s01-baseline") {
      issues.push(`${prefix}.reason is not allowed.`);
      continue;
    }
    linked += 1;
    if (source.sourceFixturePath !== s01FixturePath) issues.push(`${prefix}.sourceFixturePath must be ${s01FixturePath}.`);
    if (!isNonEmptyString(source.sourceId)) issues.push(`${prefix}.sourceId is required.`);
    if (source.caseId !== row.caseId) issues.push(`${prefix}.caseId must match S02 caseId ${row.caseId}.`);
    if (!isNonEmptyString(source.deliveryId)) issues.push(`${prefix}.deliveryId is required.`);
    if (source.promptKind !== row.promptKind) issues.push(`${prefix}.promptKind must match S02 promptKind ${row.promptKind}.`);
    if (source.sectionName !== row.sectionName) issues.push(`${prefix}.sectionName must match S02 sectionName ${row.sectionName}.`);
    if (!isFiniteNonNegativeInteger(source.baselineChars)) issues.push(`${prefix}.baselineChars must be a non-negative integer.`);
    if (!isFiniteNonNegativeInteger(source.baselineEstimatedTokens)) issues.push(`${prefix}.baselineEstimatedTokens must be a non-negative integer.`);
    const match = s01Rows.find((candidate) => candidate.sourceId === source.sourceId);
    if (!match) {
      issues.push(`${prefix}.sourceId does not match an S01 prompt section row.`);
      continue;
    }
    if (match.sourceFixturePath !== source.sourceFixturePath) issues.push(`${prefix}.sourceFixturePath does not match S01 row.`);
    if (match.caseId !== source.caseId) issues.push(`${prefix}.caseId does not match S01 row.`);
    if (match.deliveryId !== source.deliveryId) issues.push(`${prefix}.deliveryId does not match S01 row.`);
    if (match.promptKind !== source.promptKind) issues.push(`${prefix}.promptKind does not match S01 row.`);
    if (match.sectionName !== source.sectionName) issues.push(`${prefix}.sectionName does not match S01 row.`);
    if (match.baselineChars !== source.baselineChars) issues.push(`${prefix}.baselineChars does not match S01 row.`);
    if (match.baselineEstimatedTokens !== source.baselineEstimatedTokens) issues.push(`${prefix}.baselineEstimatedTokens does not match S01 row.`);
    if (match.baselineChars < row.includedChars) issues.push(`${prefix}.baselineChars must cover includedChars for ${row.sectionName}.`);
    if (match.baselineEstimatedTokens < row.includedTokens) issues.push(`${prefix}.baselineEstimatedTokens must cover includedTokens for ${row.sectionName}.`);
  }
  if (linked === 0) issues.push("S02 must include at least one s01-baseline linked section.");
  return boundIssues(issues);
}

function validateR131Disposition(fixture: unknown): string[] {
  if (!isRecord(fixture) || !isRecord(fixture.r131Disposition)) return ["r131Disposition object is required."];
  const disposition = fixture.r131Disposition;
  const issues: string[] = [];
  const status = disposition.status;
  if (disposition.requirementId !== "R131") issues.push("r131Disposition.requirementId must be R131.");
  if (!ALLOWED_R131_STATUSES.has(status as R131DispositionStatus)) issues.push("r131Disposition.status must be bounded-evidence-present or formally-rescoped.");
  for (const key of ["owner", "followUp", "rationale", "nonCompletionWording"] as const) {
    if (!isNonEmptyString(disposition[key])) issues.push(`r131Disposition.${key} is required.`);
  }
  if (disposition.m073PublishesSpecialistLaneOutputs !== false) issues.push("r131Disposition.m073PublishesSpecialistLaneOutputs must be false.");
  if (isNonEmptyString(disposition.nonCompletionWording) && !NON_COMPLETION_PATTERN.test(disposition.nonCompletionWording)) {
    issues.push("r131Disposition.nonCompletionWording must explicitly say R131 is not complete or is deferred/re-scoped.");
  }
  const combinedWording = [disposition.rationale, disposition.nonCompletionWording, disposition.followUp].filter(isNonEmptyString).join(" ");
  if (COMPLETION_CLAIM_PATTERN.test(combinedWording) && !NON_COMPLETION_PATTERN.test(combinedWording)) {
    issues.push("r131Disposition wording appears to claim completion without bounded specialist proof.");
  }
  if (status === "bounded-evidence-present") {
    if (!isRecord(disposition.boundedSpecialistAggregateEvidence)) {
      issues.push("r131Disposition.boundedSpecialistAggregateEvidence is required for bounded-evidence-present.");
    } else {
      const aggregate = disposition.boundedSpecialistAggregateEvidence;
      if (numberValue(aggregate.privateLaneObservationCount) < 1) issues.push("r131Disposition.boundedSpecialistAggregateEvidence.privateLaneObservationCount must be positive.");
      if (aggregate.rawOutputsPublished !== false) issues.push("r131Disposition.boundedSpecialistAggregateEvidence.rawOutputsPublished must be false.");
    }
  }
  return issues;
}

function validateS06Compatibility(s02Fixture: unknown, s06Fixture: unknown, s07Fixture: unknown): string[] {
  const issues: string[] = [];
  const s02Rows = readS02Rows(s02Fixture);
  const s06Proof = isRecord(s06Fixture) ? s06Fixture.liveProof : undefined;
  if (!isRecord(s06Proof)) return ["S06 fixture liveProof object is required."];
  const upstreamS02 = isRecord(s06Proof.upstreamEvidence) && isRecord(s06Proof.upstreamEvidence.s02) ? s06Proof.upstreamEvidence.s02 : undefined;
  if (!isRecord(upstreamS02)) issues.push("S06 liveProof.upstreamEvidence.s02 is required.");
  if (isRecord(upstreamS02) && upstreamS02.overallPassed !== true) issues.push("S06 liveProof.upstreamEvidence.s02.overallPassed must be true.");
  if (isRecord(upstreamS02) && upstreamS02.statusCode !== "m073_s02_ok") issues.push("S06 liveProof.upstreamEvidence.s02.statusCode must be m073_s02_ok.");
  const s06SectionCount = readS06S02SectionCount(s06Fixture);
  if (s06SectionCount !== s02Rows.length) issues.push(`S06 S02 section count ${s06SectionCount} must match S02 section count ${s02Rows.length}.`);
  const disposition = isRecord(s07Fixture) && isRecord(s07Fixture.r131Disposition) ? s07Fixture.r131Disposition : {};
  if (disposition.m073PublishesSpecialistLaneOutputs !== false) issues.push("S07 must declare that M073 does not publish specialist lane outputs.");
  return issues;
}

function validateRedaction(value: unknown, path = "fixture", issues: string[] = []): string[] {
  if (issues.length >= MAX_ISSUES) return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateRedaction(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (!isRecord(value)) {
    if (typeof value === "string") {
      if (value.length > MAX_BOUNDED_STRING_LENGTH) issues.push(`${path} string value exceeds bounded length.`);
      if (SECRET_LIKE_VALUE.test(value)) issues.push(`${path} contains a secret-like value.`);
    }
    return issues;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_KEYS.test(key)) issues.push(`${childPath} uses a forbidden raw payload field name.`);
    validateRedaction(child, childPath, issues);
  }
  return boundIssues(issues);
}

function validateNegativeCases(fixture: unknown): string[] {
  if (!isRecord(fixture)) return ["Fixture root must be an object."];
  const coverage = fixture.negativeCoverage;
  if (!Array.isArray(coverage)) return ["negativeCoverage must be an array."];
  const issues: string[] = [];
  const covered = new Set<string>();
  for (const [index, item] of coverage.entries()) {
    if (!isRecord(item)) {
      issues.push(`negativeCoverage[${index}] must be an object.`);
      continue;
    }
    if (!isNonEmptyString(item.caseId)) issues.push(`negativeCoverage[${index}].caseId is required.`);
    if (!Array.isArray(item.expectedFailedCheckIds) || item.expectedFailedCheckIds.length === 0) {
      issues.push(`negativeCoverage[${index}].expectedFailedCheckIds must contain at least one check id.`);
      continue;
    }
    for (const id of item.expectedFailedCheckIds) {
      if (!isS07CheckId(id)) {
        issues.push(`negativeCoverage[${index}] references unknown check id.`);
        continue;
      }
      covered.add(id);
    }
  }
  for (const required of ["s01-s02-linkage.cross-checked", "r131-disposition.explicit", "redaction.safe"] as const) {
    if (!covered.has(required)) issues.push(`negativeCoverage must cover ${required}.`);
  }
  return issues;
}

function buildObservedTotals(fixture: unknown, s01Rows: readonly S01BaselineSectionRow[], s02Rows: readonly S02SectionRow[], s06Fixture: unknown): M073S07ObservedTotals {
  const linkedRows = s02Rows.filter((row) => row.baselineSource?.reason === "s01-baseline");
  const matchedLinkCount = linkedRows.filter((row) => {
    const sourceId = row.baselineSource?.sourceId;
    return typeof sourceId === "string" && s01Rows.some((candidate) => candidate.sourceId === sourceId);
  }).length;
  const disposition = isRecord(fixture) && isRecord(fixture.r131Disposition) ? fixture.r131Disposition : undefined;
  const status = disposition && ALLOWED_R131_STATUSES.has(disposition.status as R131DispositionStatus)
    ? disposition.status as R131DispositionStatus
    : disposition ? "invalid" : "missing";
  return {
    s01BaselineRowCount: s01Rows.length,
    s02ObservationCount: uniqueSorted(s02Rows.map((row) => `${row.observationIndex}`)).length,
    s02SectionCount: s02Rows.length,
    s02LinkedSectionCount: linkedRows.length,
    s02NewSectionCount: s02Rows.filter((row) => row.baselineSource?.reason === "new-budget-section").length,
    s02BypassedSectionCount: s02Rows.filter((row) => row.budgetStatus === "bypassed").length,
    matchedLinkCount,
    unmatchedLinkCount: Math.max(0, linkedRows.length - matchedLinkCount),
    s06S02SectionCount: readS06S02SectionCount(s06Fixture),
    negativeCaseCount: isRecord(fixture) && Array.isArray(fixture.negativeCoverage) ? fixture.negativeCoverage.length : 0,
    r131DispositionStatus: status,
    m073PublishesSpecialistLaneOutputs: disposition && typeof disposition.m073PublishesSpecialistLaneOutputs === "boolean" ? disposition.m073PublishesSpecialistLaneOutputs : null,
  };
}

function readS06S02SectionCount(s06Fixture: unknown): number {
  if (!isRecord(s06Fixture) || !isRecord(s06Fixture.liveProof)) return 0;
  const proof = s06Fixture.liveProof;
  if (isRecord(proof.budgetSummary) && typeof proof.budgetSummary.sectionCount === "number") return proof.budgetSummary.sectionCount;
  if (isRecord(proof.upstreamEvidence) && isRecord(proof.upstreamEvidence.s02) && isRecord(proof.upstreamEvidence.s02.observedTotals) && typeof proof.upstreamEvidence.s02.observedTotals.sectionCount === "number") {
    return proof.upstreamEvidence.s02.observedTotals.sectionCount;
  }
  return 0;
}

function buildFailureReport(params: {
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly statusCode: M073S07StatusCode;
  readonly checkId: M073S07CheckId;
  readonly message: string;
  readonly issues: readonly string[];
}): M073S07Report {
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

function emptyObservedTotals(): M073S07ObservedTotals {
  return {
    s01BaselineRowCount: 0,
    s02ObservationCount: 0,
    s02SectionCount: 0,
    s02LinkedSectionCount: 0,
    s02NewSectionCount: 0,
    s02BypassedSectionCount: 0,
    matchedLinkCount: 0,
    unmatchedLinkCount: 0,
    s06S02SectionCount: 0,
    negativeCaseCount: 0,
    r131DispositionStatus: "missing",
    m073PublishesSpecialistLaneOutputs: null,
  };
}

function writeReport(report: M073S07Report, options: {
  readonly json: boolean;
  readonly stdout: M073S07Writer;
  readonly stderr: M073S07Writer;
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
    `s01BaselineRows: ${report.observedTotals.s01BaselineRowCount}`,
    `s02Sections: ${report.observedTotals.s02SectionCount}`,
    `s02LinkedSections: ${report.observedTotals.s02LinkedSectionCount}`,
    `matchedLinks: ${report.observedTotals.matchedLinkCount}`,
    `unmatchedLinks: ${report.observedTotals.unmatchedLinkCount}`,
    `r131DispositionStatus: ${report.observedTotals.r131DispositionStatus}`,
    `m073PublishesSpecialistLaneOutputs: ${String(report.observedTotals.m073PublishesSpecialistLaneOutputs)}`,
    `negativeCases: ${report.observedTotals.negativeCaseCount}`,
  ];
  if (!report.overallPassed && report.issues.length > 0) {
    lines.push("issues:", ...report.issues.map((issue) => `- ${issue}`));
  }
  const stream = report.overallPassed ? options.stdout : options.stderr;
  stream.write(`${lines.join("\n")}\n`);
}

function pass(id: M073S07CheckId, message: string): M073S07Check {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: M073S07CheckId, message: string, issues: readonly string[]): M073S07Check {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}

function boundIssues(issues: readonly string[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function isS07CheckId(value: unknown): value is M073S07CheckId {
  return typeof value === "string" && (S07_CHECK_IDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
