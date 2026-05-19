export const COMMAND_NAME = "verify:m073:s02" as const;
export const DEFAULT_FIXTURE_PATH = "scripts/fixtures/m073-s02-prompt-budget.json";
export const DEFAULT_BASELINE_FIXTURE_PATH = "scripts/fixtures/m073-s01-baseline-scorecard.json";

export type PromptBudgetEvidenceStatus = "included" | "trimmed" | "bypassed";
export type PromptBudgetEvidenceReason = "within-budget" | "section-over-budget" | "zero-budget";
export type PromptBudgetBaselineSourceReason = "s01-baseline" | "new-budget-section";

export type PromptBudgetBaselineSource = {
  readonly reason: PromptBudgetBaselineSourceReason;
  readonly sourceFixturePath?: string;
  readonly sourceId?: string;
  readonly caseId?: string;
  readonly deliveryId?: string;
  readonly promptKind?: string;
  readonly sectionName?: string;
  readonly baselineChars?: number;
  readonly baselineEstimatedTokens?: number;
};

export type PromptBudgetEvidenceSection = {
  readonly sectionName: string;
  readonly sectionPosition: number;
  readonly budgetChars: number;
  readonly budgetTokens: number;
  readonly includedChars: number;
  readonly includedTokens: number;
  readonly trimmedChars: number;
  readonly trimmedTokens: number;
  readonly budgetStatus: PromptBudgetEvidenceStatus;
  readonly budgetReason: PromptBudgetEvidenceReason;
  readonly baselineSource: PromptBudgetBaselineSource;
};

export type PromptBudgetEvidenceObservation = {
  readonly caseId: string;
  readonly deliveryId: string;
  readonly repo: string;
  readonly taskType: string;
  readonly promptKind: string;
  readonly sections: readonly PromptBudgetEvidenceSection[];
};

export type PromptBudgetOverflowSummary = {
  readonly sectionCount: number;
  readonly includedSections: number;
  readonly trimmedSections: number;
  readonly bypassedSections: number;
  readonly totalBudgetChars: number;
  readonly totalBudgetTokens: number;
  readonly totalIncludedChars: number;
  readonly totalIncludedTokens: number;
  readonly totalTrimmedChars: number;
  readonly totalTrimmedTokens: number;
};

export type M073S02Fixture = {
  readonly generatedAt?: string;
  readonly promptBudgetEvidence: readonly PromptBudgetEvidenceObservation[];
  readonly overflowSummary: PromptBudgetOverflowSummary;
};

export type M073S02CheckId =
  | "fixture.shape"
  | "budget-evidence.present"
  | "budget-outcomes.valid"
  | "overflow-totals.deterministic"
  | "baseline-linkage.valid"
  | "redaction.safe";

export type M073S02Check = {
  readonly id: M073S02CheckId;
  readonly status: "pass" | "fail";
  readonly message: string;
  readonly issues: readonly string[];
};

export type M073S02StatusCode =
  | "m073_s02_ok"
  | "m073_s02_budget_evidence_failed"
  | "m073_s02_invalid_json"
  | "m073_s02_fixture_read_failed"
  | "m073_s02_invalid_arg";

export type M073S02ObservedTotals = PromptBudgetOverflowSummary & {
  readonly observationCount: number;
  readonly deliveryCount: number;
  readonly promptKinds: readonly string[];
  readonly sectionNames: readonly string[];
  readonly statuses: readonly PromptBudgetEvidenceStatus[];
  readonly reasons: readonly PromptBudgetEvidenceReason[];
  readonly baselineLinkedSections: number;
  readonly baselineNewSections: number;
  readonly baselineBypassedSections: number;
  readonly baselineFixturePaths: readonly string[];
  readonly baselineSourceIds: readonly string[];
};

export type M073S02Report = {
  readonly command: typeof COMMAND_NAME;
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly overallPassed: boolean;
  readonly statusCode: M073S02StatusCode;
  readonly failedCheckIds: readonly M073S02CheckId[];
  readonly checks: readonly M073S02Check[];
  readonly observedTotals: M073S02ObservedTotals;
  readonly issues: readonly string[];
};

export type M073S02Args = {
  readonly fixturePath: string;
  readonly json: boolean;
  readonly help: boolean;
};

export type M073S02Writer = {
  readonly write: (chunk: string) => unknown;
};

export type M073S02MainOptions = {
  readonly stdout?: M073S02Writer;
  readonly stderr?: M073S02Writer;
  readonly evaluate?: (fixturePath: string) => Promise<M073S02Report>;
};

export type EvaluateM073S02Options = {
  readonly generatedAt?: string;
  readonly readFixtureText?: (fixturePath: string) => Promise<string>;
  readonly readBaselineFixtureText?: (fixturePath: string) => Promise<string>;
  readonly baselineFixturePath?: string;
};

const HELP_TEXT = `Usage: bun scripts/verify-m073-s02.ts [--fixture <path>] [--json] [--help]\n\nVerifies the M073/S02 prompt-budget fixture without live services.\n\nOptions:\n  --fixture <path>  Local JSON fixture path (default: ${DEFAULT_FIXTURE_PATH})\n  --json            Emit machine-readable JSON only\n  --help, -h        Show this help\n`;

const MAX_ISSUES = 20;
const MAX_BOUNDED_STRING_LENGTH = 160;
const ALLOWED_STATUSES = new Set<PromptBudgetEvidenceStatus>(["included", "trimmed", "bypassed"]);
const ALLOWED_REASONS = new Set<PromptBudgetEvidenceReason>(["within-budget", "section-over-budget", "zero-budget"]);
const FORBIDDEN_RAW_TEXT_KEYS = /(^|_)(rawPrompt|promptText|prompt|diff|patch|comment|commentBody|body|candidate|candidatePayload|modelOutput|completion|content|text|includedText|trimmedText|sectionText)$/i;
const SECRET_LIKE_VALUE = /(ghp_|github_pat_|sk-[a-z0-9]|azure[_-]?client[_-]?secret|password\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function parseM073S02Args(args: readonly string[]): M073S02Args {
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

export async function evaluateM073S02Fixture(fixturePath = DEFAULT_FIXTURE_PATH, options: EvaluateM073S02Options = {}): Promise<M073S02Report> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readFixtureText = options.readFixtureText ?? ((path: string) => Bun.file(path).text());

  let fixtureText: string;
  try {
    fixtureText = await readFixtureText(fixturePath);
  } catch {
    return buildFailureReport({
      generatedAt,
      fixturePath,
      statusCode: "m073_s02_fixture_read_failed",
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
      statusCode: "m073_s02_invalid_json",
      checkId: "fixture.shape",
      message: "Fixture JSON could not be parsed.",
      issues: ["Fixture must be valid JSON."],
    });
  }

  const baselineFixturePath = options.baselineFixturePath ?? DEFAULT_BASELINE_FIXTURE_PATH;
  const readBaselineFixtureText = options.readBaselineFixtureText ?? readFixtureText;
  const baselineRows = await readBaselineRows(baselineFixturePath, readBaselineFixtureText);

  const checks = evaluatePromptBudgetFixture(fixture, baselineFixturePath, baselineRows);
  const failedChecks = checks.filter((check) => check.status === "fail");
  const observedTotals = buildObservedTotals(fixture);
  const issues = boundIssues(failedChecks.flatMap((check) => check.issues.length > 0 ? check.issues : [check.message]));

  return {
    command: COMMAND_NAME,
    generatedAt,
    fixturePath,
    overallPassed: failedChecks.length === 0,
    statusCode: failedChecks.length === 0 ? "m073_s02_ok" : "m073_s02_budget_evidence_failed",
    failedCheckIds: uniqueSorted(failedChecks.map((check) => check.id)),
    checks,
    observedTotals,
    issues,
  };
}

export async function main(args = Bun.argv.slice(2), options: M073S02MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (chunk: string) => process.stdout.write(chunk) };
  const stderr = options.stderr ?? { write: (chunk: string) => process.stderr.write(chunk) };

  let parsed: M073S02Args;
  try {
    parsed = parseM073S02Args(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_cli_args";
    const report = buildFailureReport({
      generatedAt: new Date().toISOString(),
      fixturePath: DEFAULT_FIXTURE_PATH,
      statusCode: "m073_s02_invalid_arg",
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

  const evaluate = options.evaluate ?? ((path: string) => evaluateM073S02Fixture(path));
  const report = await evaluate(parsed.fixturePath);
  writeReport(report, { json: parsed.json, stdout, stderr });
  return report.overallPassed ? 0 : 1;
}

function evaluatePromptBudgetFixture(fixture: unknown, baselineFixturePath: string, baselineRows: readonly S01BaselineSectionRow[]): M073S02Check[] {
  const checks: M073S02Check[] = [];
  const shapeIssues = validateFixtureShape(fixture);
  checks.push(shapeIssues.length === 0
    ? pass("fixture.shape", "Fixture has the required prompt-budget evidence shape.")
    : fail("fixture.shape", "Fixture shape is invalid.", shapeIssues));

  const observations = readObservations(fixture);
  checks.push(observations.length > 0
    ? pass("budget-evidence.present", "Fixture includes prompt-budget evidence observations.")
    : fail("budget-evidence.present", "Fixture must include at least one prompt-budget evidence observation.", ["promptBudgetEvidence must contain at least one row."]));

  const outcomeIssues = validateBudgetOutcomes(observations);
  checks.push(outcomeIssues.length === 0
    ? pass("budget-outcomes.valid", "Prompt-budget section outcomes use bounded statuses, reasons, and counts.")
    : fail("budget-outcomes.valid", "Prompt-budget section outcomes are invalid.", outcomeIssues));

  const overflowIssues = validateOverflowSummary(fixture, observations);
  checks.push(overflowIssues.length === 0
    ? pass("overflow-totals.deterministic", "Overflow totals match deterministic sums from section outcomes.")
    : fail("overflow-totals.deterministic", "Overflow totals do not match deterministic section sums.", overflowIssues));

  const baselineIssues = validateBaselineLinkage(observations, baselineFixturePath, baselineRows);
  checks.push(baselineIssues.length === 0
    ? pass("baseline-linkage.valid", "Prompt-budget sections cite bounded S01 baseline inputs or explicit new-section reasons.")
    : fail("baseline-linkage.valid", "Prompt-budget baseline linkage is invalid.", baselineIssues));

  const redactionIssues = validateRedaction(fixture);
  checks.push(redactionIssues.length === 0
    ? pass("redaction.safe", "Prompt-budget fixture is text-free and bounded.")
    : fail("redaction.safe", "Prompt-budget fixture contains raw text or unbounded values.", redactionIssues));

  return checks;
}

function validateFixtureShape(fixture: unknown): string[] {
  if (!isPlainObject(fixture)) {
    return ["Fixture root must be an object."];
  }
  const issues: string[] = [];
  if (!Array.isArray(fixture.promptBudgetEvidence)) {
    issues.push("promptBudgetEvidence must be an array.");
  }
  if (!isPlainObject(fixture.overflowSummary)) {
    issues.push("overflowSummary must be an object.");
  }
  return issues;
}

function validateBudgetOutcomes(observations: readonly PromptBudgetEvidenceObservation[]): string[] {
  const issues: string[] = [];
  const seenByObservation = new Set<string>();

  observations.forEach((observation, observationIndex) => {
    const prefix = `promptBudgetEvidence[${observationIndex}]`;
    if (!isNonEmptyString(observation.caseId)) issues.push(`${prefix} is missing caseId.`);
    if (!isNonEmptyString(observation.deliveryId)) issues.push(`${prefix} is missing deliveryId.`);
    if (!isNonEmptyString(observation.repo)) issues.push(`${prefix} is missing repo.`);
    if (!isNonEmptyString(observation.taskType)) issues.push(`${prefix} is missing taskType.`);
    if (!isNonEmptyString(observation.promptKind)) issues.push(`${prefix} is missing promptKind.`);
    if (!Array.isArray(observation.sections) || observation.sections.length === 0) {
      issues.push(`${prefix}.sections must contain at least one section.`);
      return;
    }

    const observationKey = `${observation.caseId}\u0000${observation.deliveryId}\u0000${observation.promptKind}`;
    if (seenByObservation.has(observationKey)) {
      issues.push(`${prefix} duplicates caseId/deliveryId/promptKind.`);
    }
    seenByObservation.add(observationKey);

    const seenPositions = new Set<number>();
    const seenNames = new Set<string>();
    observation.sections.forEach((section, sectionIndex) => {
      const sectionPrefix = `${prefix}.sections[${sectionIndex}]`;
      validateSection(section, sectionPrefix, issues);
      if (seenPositions.has(section.sectionPosition)) {
        issues.push(`${sectionPrefix} duplicates sectionPosition ${section.sectionPosition}.`);
      }
      if (seenNames.has(section.sectionName)) {
        issues.push(`${sectionPrefix} duplicates sectionName within an observation.`);
      }
      seenPositions.add(section.sectionPosition);
      seenNames.add(section.sectionName);
    });
  });

  return issues;
}

function validateSection(section: PromptBudgetEvidenceSection, sectionPrefix: string, issues: string[]): void {
  if (!isNonEmptyString(section.sectionName)) issues.push(`${sectionPrefix} is missing sectionName.`);
  if (!isFiniteNonNegativeInteger(section.sectionPosition)) issues.push(`${sectionPrefix}.sectionPosition must be a non-negative integer.`);
  if (!isFiniteNonNegativeInteger(section.budgetChars)) issues.push(`${sectionPrefix}.budgetChars must be a non-negative integer.`);
  if (!isFiniteNonNegativeInteger(section.budgetTokens)) issues.push(`${sectionPrefix}.budgetTokens must be a non-negative integer.`);
  if (!isFiniteNonNegativeInteger(section.includedChars)) issues.push(`${sectionPrefix}.includedChars must be a non-negative integer.`);
  if (!isFiniteNonNegativeInteger(section.includedTokens)) issues.push(`${sectionPrefix}.includedTokens must be a non-negative integer.`);
  if (!isFiniteNonNegativeInteger(section.trimmedChars)) issues.push(`${sectionPrefix}.trimmedChars must be a non-negative integer.`);
  if (!isFiniteNonNegativeInteger(section.trimmedTokens)) issues.push(`${sectionPrefix}.trimmedTokens must be a non-negative integer.`);
  if (!ALLOWED_STATUSES.has(section.budgetStatus)) issues.push(`${sectionPrefix}.budgetStatus is not allowed.`);
  if (!ALLOWED_REASONS.has(section.budgetReason)) issues.push(`${sectionPrefix}.budgetReason is not allowed.`);

  if (isFiniteNonNegativeInteger(section.budgetChars) && isFiniteNonNegativeInteger(section.includedChars) && section.includedChars > section.budgetChars) {
    issues.push(`${sectionPrefix}.includedChars exceeds budgetChars.`);
  }
  if (section.budgetStatus === "included" && (section.trimmedChars !== 0 || section.budgetReason !== "within-budget")) {
    issues.push(`${sectionPrefix} included status must have zero trimmedChars and within-budget reason.`);
  }
  if (section.budgetStatus === "trimmed" && (section.trimmedChars <= 0 || section.budgetReason !== "section-over-budget")) {
    issues.push(`${sectionPrefix} trimmed status must have positive trimmedChars and section-over-budget reason.`);
  }
  if (section.budgetStatus === "bypassed" && (section.budgetChars !== 0 || section.includedChars !== 0 || section.budgetReason !== "zero-budget")) {
    issues.push(`${sectionPrefix} bypassed status must have zero budgetChars, zero includedChars, and zero-budget reason.`);
  }
}

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

async function readBaselineRows(baselineFixturePath: string, readText: (fixturePath: string) => Promise<string>): Promise<S01BaselineSectionRow[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(baselineFixturePath));
  } catch {
    return [];
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.promptSections)) {
    return [];
  }
  const rows: S01BaselineSectionRow[] = [];
  parsed.promptSections.filter(isPlainObject).forEach((promptSection) => {
    if (!isNonEmptyString(promptSection.caseId) || !isNonEmptyString(promptSection.deliveryId) || !isNonEmptyString(promptSection.promptKind) || !Array.isArray(promptSection.sections)) {
      return;
    }
    promptSection.sections.filter(isPlainObject).forEach((section) => {
      if (!isNonEmptyString(section.sectionName) || !isFiniteNonNegativeInteger(section.charCount) || !isFiniteNonNegativeInteger(section.estimatedTokens)) {
        return;
      }
      const row = {
        sourceFixturePath: baselineFixturePath,
        sourceId: `${promptSection.caseId}:${promptSection.deliveryId}:${promptSection.promptKind}:${section.sectionName}`,
        caseId: promptSection.caseId,
        deliveryId: promptSection.deliveryId,
        promptKind: promptSection.promptKind,
        sectionName: section.sectionName,
        baselineChars: section.charCount,
        baselineEstimatedTokens: section.estimatedTokens,
      };
      rows.push(row);
    });
  });
  return rows;
}

function validateBaselineLinkage(observations: readonly PromptBudgetEvidenceObservation[], baselineFixturePath: string, baselineRows: readonly S01BaselineSectionRow[]): string[] {
  const issues: string[] = [];
  observations.forEach((observation, observationIndex) => {
    observation.sections.forEach((section, sectionIndex) => {
      const sectionPrefix = `promptBudgetEvidence[${observationIndex}].sections[${sectionIndex}]`;
      const source = section.baselineSource;
      if (!isPlainObject(source)) {
        issues.push(`${sectionPrefix}.baselineSource is required.`);
        return;
      }
      if (source.reason !== "s01-baseline" && source.reason !== "new-budget-section") {
        issues.push(`${sectionPrefix}.baselineSource.reason is not allowed.`);
        return;
      }
      if (source.reason === "new-budget-section") {
        if (source.sourceFixturePath !== undefined || source.sourceId !== undefined || source.baselineChars !== undefined || source.baselineEstimatedTokens !== undefined) {
          issues.push(`${sectionPrefix}.baselineSource new-budget-section must not claim S01 fixture ids or baseline counts.`);
        }
        return;
      }

      const sourcePrefix = `${sectionPrefix}.baselineSource`;
      if (source.sourceFixturePath !== baselineFixturePath) issues.push(`${sourcePrefix}.sourceFixturePath must be ${baselineFixturePath}.`);
      if (!isNonEmptyString(source.sourceId)) issues.push(`${sourcePrefix}.sourceId is required.`);
      if (source.caseId !== observation.caseId) issues.push(`${sourcePrefix}.caseId must match ${observation.caseId}.`);
      if (!isNonEmptyString(source.deliveryId)) issues.push(`${sourcePrefix}.deliveryId is required.`);
      if (source.promptKind !== observation.promptKind) issues.push(`${sourcePrefix}.promptKind must match ${observation.promptKind}.`);
      if (source.sectionName !== section.sectionName) issues.push(`${sourcePrefix}.sectionName must match ${section.sectionName}.`);
      if (!isFiniteNonNegativeInteger(source.baselineChars)) issues.push(`${sourcePrefix}.baselineChars must be a non-negative integer.`);
      if (!isFiniteNonNegativeInteger(source.baselineEstimatedTokens)) issues.push(`${sourcePrefix}.baselineEstimatedTokens must be a non-negative integer.`);

      const matchingBaseline = baselineRows.find((row) => row.sourceId === source.sourceId);
      if (!matchingBaseline) {
        issues.push(`${sourcePrefix}.sourceId does not match an S01 baseline row.`);
        return;
      }
      if (matchingBaseline.sourceFixturePath !== source.sourceFixturePath) issues.push(`${sourcePrefix}.sourceFixturePath does not match S01 baseline row.`);
      if (matchingBaseline.caseId !== source.caseId) issues.push(`${sourcePrefix}.caseId does not match S01 baseline row.`);
      if (matchingBaseline.deliveryId !== source.deliveryId) issues.push(`${sourcePrefix}.deliveryId does not match S01 baseline row.`);
      if (matchingBaseline.promptKind !== source.promptKind) issues.push(`${sourcePrefix}.promptKind does not match S01 baseline row.`);
      if (matchingBaseline.sectionName !== source.sectionName) issues.push(`${sourcePrefix}.sectionName does not match S01 baseline row.`);
      if (matchingBaseline.baselineChars !== source.baselineChars) issues.push(`${sourcePrefix}.baselineChars does not match S01 baseline row.`);
      if (matchingBaseline.baselineEstimatedTokens !== source.baselineEstimatedTokens) issues.push(`${sourcePrefix}.baselineEstimatedTokens does not match S01 baseline row.`);
      if (matchingBaseline.baselineChars < section.includedChars) {
        issues.push(`${sourcePrefix}.baselineChars must be at least includedChars for ${section.sectionName}.`);
      }
      if (matchingBaseline.baselineEstimatedTokens < section.includedTokens) {
        issues.push(`${sourcePrefix}.baselineEstimatedTokens must be at least includedTokens for ${section.sectionName}.`);
      }
    });
  });
  return issues;
}

function validateOverflowSummary(fixture: unknown, observations: readonly PromptBudgetEvidenceObservation[]): string[] {
  if (!isPlainObject(fixture) || !isPlainObject(fixture.overflowSummary)) {
    return ["overflowSummary is required to prove deterministic totals."];
  }
  const observed = calculateOverflowSummary(observations);
  const expected = fixture.overflowSummary;
  const issues: string[] = [];
  for (const key of OVERFLOW_SUMMARY_KEYS) {
    const value = expected[key];
    if (!isFiniteNonNegativeInteger(value)) {
      issues.push(`overflowSummary.${key} must be a non-negative integer.`);
      continue;
    }
    if (value !== observed[key]) {
      issues.push(`overflowSummary.${key} expected ${observed[key]} but found ${value}.`);
    }
  }
  return issues;
}

function validateRedaction(value: unknown, path = "fixture"): string[] {
  const issues: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => issues.push(...validateRedaction(item, `${path}[${index}]`)));
    return issues;
  }
  if (!isPlainObject(value)) {
    if (typeof value === "string") {
      if (value.length > MAX_BOUNDED_STRING_LENGTH) {
        issues.push(`${path} string value exceeds bounded length.`);
      }
      if (SECRET_LIKE_VALUE.test(value)) {
        issues.push(`${path} contains a secret-like value.`);
      }
    }
    return issues;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_TEXT_KEYS.test(key)) {
      issues.push(`${childPath} is a forbidden raw-text field.`);
      continue;
    }
    issues.push(...validateRedaction(child, childPath));
  }
  return issues;
}

const OVERFLOW_SUMMARY_KEYS = [
  "sectionCount",
  "includedSections",
  "trimmedSections",
  "bypassedSections",
  "totalBudgetChars",
  "totalBudgetTokens",
  "totalIncludedChars",
  "totalIncludedTokens",
  "totalTrimmedChars",
  "totalTrimmedTokens",
] as const;

function calculateOverflowSummary(observations: readonly PromptBudgetEvidenceObservation[]): PromptBudgetOverflowSummary {
  const sections = observations.flatMap((observation) => [...observation.sections]);
  return {
    sectionCount: sections.length,
    includedSections: sections.filter((section) => section.budgetStatus === "included").length,
    trimmedSections: sections.filter((section) => section.budgetStatus === "trimmed").length,
    bypassedSections: sections.filter((section) => section.budgetStatus === "bypassed").length,
    totalBudgetChars: sum(sections, "budgetChars"),
    totalBudgetTokens: sum(sections, "budgetTokens"),
    totalIncludedChars: sum(sections, "includedChars"),
    totalIncludedTokens: sum(sections, "includedTokens"),
    totalTrimmedChars: sum(sections, "trimmedChars"),
    totalTrimmedTokens: sum(sections, "trimmedTokens"),
  };
}

function buildObservedTotals(fixture: unknown): M073S02ObservedTotals {
  const observations = readObservations(fixture);
  const summary = calculateOverflowSummary(observations);
  const deliveryIds = observations.map((observation) => observation.deliveryId).filter(isNonEmptyString);
  const promptKinds = observations.map((observation) => observation.promptKind).filter(isNonEmptyString);
  const sections = observations.flatMap((observation) => [...observation.sections]);
  const baselineSources = sections.map((section) => section.baselineSource).filter(isPlainObject);
  return {
    ...summary,
    observationCount: observations.length,
    deliveryCount: uniqueSorted(deliveryIds).length,
    promptKinds: uniqueSorted(promptKinds),
    sectionNames: uniqueSorted(sections.map((section) => section.sectionName).filter(isNonEmptyString)),
    statuses: uniqueSorted(sections.map((section) => section.budgetStatus).filter(isPromptBudgetEvidenceStatus)),
    reasons: uniqueSorted(sections.map((section) => section.budgetReason).filter(isPromptBudgetEvidenceReason)),
    baselineLinkedSections: baselineSources.filter((source) => source.reason === "s01-baseline").length,
    baselineNewSections: baselineSources.filter((source) => source.reason === "new-budget-section").length,
    baselineBypassedSections: sections.filter((section) => section.budgetStatus === "bypassed").length,
    baselineFixturePaths: uniqueSorted(baselineSources.map((source) => typeof source.sourceFixturePath === "string" ? source.sourceFixturePath : "").filter(isNonEmptyString)),
    baselineSourceIds: uniqueSorted(baselineSources.map((source) => typeof source.sourceId === "string" ? source.sourceId : "").filter(isNonEmptyString)),
  };
}

function readObservations(fixture: unknown): PromptBudgetEvidenceObservation[] {
  if (!isPlainObject(fixture) || !Array.isArray(fixture.promptBudgetEvidence)) {
    return [];
  }
  return fixture.promptBudgetEvidence.filter(isPlainObject).map((row) => ({
    caseId: typeof row.caseId === "string" ? row.caseId : "",
    deliveryId: typeof row.deliveryId === "string" ? row.deliveryId : "",
    repo: typeof row.repo === "string" ? row.repo : "",
    taskType: typeof row.taskType === "string" ? row.taskType : "",
    promptKind: typeof row.promptKind === "string" ? row.promptKind : "",
    sections: Array.isArray(row.sections)
      ? row.sections.filter(isPlainObject).map((section) => ({
          sectionName: typeof section.sectionName === "string" ? section.sectionName : "",
          sectionPosition: typeof section.sectionPosition === "number" ? section.sectionPosition : -1,
          budgetChars: typeof section.budgetChars === "number" ? section.budgetChars : -1,
          budgetTokens: typeof section.budgetTokens === "number" ? section.budgetTokens : -1,
          includedChars: typeof section.includedChars === "number" ? section.includedChars : -1,
          includedTokens: typeof section.includedTokens === "number" ? section.includedTokens : -1,
          trimmedChars: typeof section.trimmedChars === "number" ? section.trimmedChars : -1,
          trimmedTokens: typeof section.trimmedTokens === "number" ? section.trimmedTokens : -1,
          budgetStatus: section.budgetStatus as PromptBudgetEvidenceStatus,
          budgetReason: section.budgetReason as PromptBudgetEvidenceReason,
          baselineSource: isPlainObject(section.baselineSource) ? section.baselineSource as PromptBudgetBaselineSource : {} as PromptBudgetBaselineSource,
        }))
      : [],
  }));
}

function buildFailureReport(params: {
  readonly generatedAt: string;
  readonly fixturePath: string;
  readonly statusCode: M073S02StatusCode;
  readonly checkId: M073S02CheckId;
  readonly message: string;
  readonly issues: readonly string[];
}): M073S02Report {
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

function emptyObservedTotals(): M073S02ObservedTotals {
  return {
    observationCount: 0,
    deliveryCount: 0,
    promptKinds: [],
    sectionNames: [],
    statuses: [],
    reasons: [],
    baselineLinkedSections: 0,
    baselineNewSections: 0,
    baselineBypassedSections: 0,
    baselineFixturePaths: [],
    baselineSourceIds: [],
    sectionCount: 0,
    includedSections: 0,
    trimmedSections: 0,
    bypassedSections: 0,
    totalBudgetChars: 0,
    totalBudgetTokens: 0,
    totalIncludedChars: 0,
    totalIncludedTokens: 0,
    totalTrimmedChars: 0,
    totalTrimmedTokens: 0,
  };
}

function writeReport(report: M073S02Report, options: {
  readonly json: boolean;
  readonly stdout: M073S02Writer;
  readonly stderr: M073S02Writer;
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
    `observations: ${report.observedTotals.observationCount}`,
    `sections: ${report.observedTotals.sectionCount}`,
    `trimmedSections: ${report.observedTotals.trimmedSections}`,
    `totalTrimmedChars: ${report.observedTotals.totalTrimmedChars}`,
    `totalTrimmedTokens: ${report.observedTotals.totalTrimmedTokens}`,
    `baselineLinkedSections: ${report.observedTotals.baselineLinkedSections}`,
    `baselineNewSections: ${report.observedTotals.baselineNewSections}`,
    `baselineBypassedSections: ${report.observedTotals.baselineBypassedSections}`,
  ];
  if (!report.overallPassed && report.issues.length > 0) {
    lines.push("issues:", ...report.issues.map((issue) => `- ${issue}`));
  }
  const stream = report.overallPassed ? options.stdout : options.stderr;
  stream.write(`${lines.join("\n")}\n`);
}

function pass(id: M073S02CheckId, message: string): M073S02Check {
  return { id, status: "pass", message, issues: [] };
}

function fail(id: M073S02CheckId, message: string, issues: readonly string[]): M073S02Check {
  return { id, status: "fail", message, issues: boundIssues(issues) };
}

function boundIssues(issues: readonly string[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => issue.length > 220 ? `${issue.slice(0, 217)}...` : issue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isPromptBudgetEvidenceStatus(value: unknown): value is PromptBudgetEvidenceStatus {
  return typeof value === "string" && ALLOWED_STATUSES.has(value as PromptBudgetEvidenceStatus);
}

function isPromptBudgetEvidenceReason(value: unknown): value is PromptBudgetEvidenceReason {
  return typeof value === "string" && ALLOWED_REASONS.has(value as PromptBudgetEvidenceReason);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

type PromptBudgetSectionNumericKey =
  | "budgetChars"
  | "budgetTokens"
  | "includedChars"
  | "includedTokens"
  | "trimmedChars"
  | "trimmedTokens";

function sum(sections: readonly PromptBudgetEvidenceSection[], key: PromptBudgetSectionNumericKey): number {
  return sections.reduce((total, section) => total + section[key], 0);
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
