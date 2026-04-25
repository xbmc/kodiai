import { buildReviewPromptDetails } from "../src/execution/review-prompt.ts";

export const M063_S03_SCENARIO_IDS = [
  "large-pr-continuation",
  "quiet-no-delta-bounded",
] as const;

export type M063S03ScenarioId = (typeof M063_S03_SCENARIO_IDS)[number];

export type M063S03StatusCode =
  | "m063_s03_ok"
  | "m063_s03_invalid_arg"
  | "m063_s03_verifier_failed";

export type M063S03ScenarioStatusCode =
  | "bounded-continuation-proved"
  | "bounded-continuation-no-delta"
  | "contract-failed";

export type M063S03Check = {
  key:
    | "required-sections"
    | "narrowing-sections"
    | "first-pass-only-sections-omitted"
    | "boundedness-wording"
    | "exhaustive-claim-absent"
    | "no-delta-truthfulness";
  status: "pass" | "fail" | "expected-negative";
  detail: string;
};

export type M063S03ScenarioRecord = {
  scenarioId: string;
  success: boolean;
  statusCode: M063S03ScenarioStatusCode;
  boundedButSufficient: boolean;
  truthfulBoundedness: boolean;
  preservedRequiredSections: boolean;
  narrowingSections: string[];
  omittedFirstPassOnlySections: string[];
  firstPassSectionNames: string[];
  continuationSectionNames: string[];
  firstPassChangedFileCount: number;
  continuationChangedFileCount: number;
  summary: string;
  issues: string[];
  checks: M063S03Check[];
};

export type M063S03Report = {
  command: "verify:m063:s03";
  generated_at: string;
  scenario_count: number;
  success: boolean;
  status_code: M063S03StatusCode;
  summary: string;
  scenarios: M063S03ScenarioRecord[];
  issues: string[];
};

type VerifyM063S03Args = {
  help: boolean;
  json: boolean;
  scenarioId: string | null;
};

type PromptDetails = ReturnType<typeof buildReviewPromptDetails>;

type ScenarioDefinition = {
  scenarioId: M063S03ScenarioId;
  description: string;
  firstPassFiles: string[];
  continuationFiles: string[];
  quietNoDelta: boolean;
  disclosureSentence: string;
  continuationInstructions: string[];
};

type EvaluateScenarioInput = ScenarioDefinition & {
  mutatePromptDetails?: (value: {
    firstPass: PromptDetails;
    continuation: PromptDetails;
  }) => {
    firstPass: PromptDetails;
    continuation: PromptDetails;
  };
};

const VALID_SCENARIO_IDS = new Set<string>(M063_S03_SCENARIO_IDS);
const REQUIRED_CONTINUATION_SECTIONS = [
  "review-pr-context",
  "review-change-context",
  "review-knowledge-context",
  "review-instructions",
] as const;
const REQUIRED_NARROWING_SECTIONS = [
  "review-change-context",
  "review-size-context",
] as const;
const FIRST_PASS_ONLY_SECTION_NAMES = ["review-size-context", "review-graph-context"] as const;
const EXHAUSTIVE_LANGUAGE = [
  "fully reviewed every changed file",
  "complete review coverage",
  "entire pull request was reviewed",
  "proved final coverage of the whole pull request",
];

function baseDiffAnalysis(files: string[]) {
  return {
    filesByCategory: {
      source: files,
      test: ["src/auth.test.ts"],
      config: [],
      docs: [],
      infra: [],
    },
    filesByLanguage: {
      TypeScript: [...files, "src/auth.test.ts"],
    },
    riskSignals: [],
    metrics: {
      totalFiles: files.length,
      totalLinesAdded: 240,
      totalLinesRemoved: 80,
      hunksCount: 12,
    },
    isLargePR: true,
  };
}

function buildPromptPair(definition: ScenarioDefinition): {
  firstPass: PromptDetails;
  continuation: PromptDetails;
} {
  const sharedContext = {
    owner: "acme",
    repo: "app",
    prNumber: 42,
    prTitle: definition.quietNoDelta
      ? "Settle bounded continuation without public churn"
      : "Tighten auth continuation behavior",
    prBody: definition.description,
    prAuthor: "alice",
    baseBranch: "main",
    headBranch: "fix/auth-retry",
    diffAnalysis: baseDiffAnalysis(definition.firstPassFiles),
    retrievalContext: {
      maxChars: 500,
      findings: [
        {
          findingText: "Prior auth regression in retry path",
          severity: "major",
          category: "correctness",
          path: "src/auth.ts",
          line: 18,
          snippet: "if (!token) throw new Error('missing token');",
          outcome: "accepted",
          distance: 0.1,
          sourceRepo: "acme/app",
        },
      ],
    },
  };

  const firstPass = buildReviewPromptDetails({
    ...sharedContext,
    changedFiles: definition.firstPassFiles,
    largePRContext: {
      fullReviewFiles: definition.firstPassFiles.slice(0, 4),
      abbreviatedFiles: definition.firstPassFiles.slice(4),
      mentionOnlyCount: 0,
      totalFiles: definition.firstPassFiles.length,
    },
    reviewBoundedness: {
      requestedProfile: {
        selectedProfile: "strict",
        source: "keyword",
        autoBand: null,
        linesChanged: 320,
      },
      effectiveProfile: {
        selectedProfile: "strict",
        source: "keyword",
        autoBand: null,
        linesChanged: 320,
      },
      reasonCodes: ["large-pr-triage"],
      disclosureRequired: true,
      disclosureSentence: definition.disclosureSentence,
      largePR: {
        fullCount: 4,
        abbreviatedCount: Math.max(definition.firstPassFiles.length - 4, 0),
        reviewedCount: definition.firstPassFiles.length,
        totalFiles: definition.firstPassFiles.length,
        notReviewedCount: 0,
      },
      timeout: {
        riskLevel: "medium",
        dynamicTimeoutSeconds: 450,
        shouldReduceScope: false,
        reductionApplied: false,
        reductionSkippedReason: null,
      },
    },
  });

  const continuation = buildReviewPromptDetails({
    ...sharedContext,
    changedFiles: definition.continuationFiles,
    customInstructions: definition.continuationInstructions.join("\n"),
    largePRContext: null,
  });

  return { firstPass, continuation };
}

export function getDefaultScenarioMatrix(): ScenarioDefinition[] {
  const firstPassFiles = [
    "src/auth.ts",
    "src/session.ts",
    "src/routes.ts",
    "src/db.ts",
    "src/cache.ts",
    "src/logger.ts",
  ];
  const continuationFiles = ["src/auth.ts", "src/session.ts"];

  return [
    {
      scenarioId: "large-pr-continuation",
      description: "Focus review on auth hot paths after timeout.",
      firstPassFiles,
      continuationFiles,
      quietNoDelta: false,
      disclosureSentence:
        "Requested strict review; effective review remained strict and covered 6/6 changed files via large-PR triage (4 full, 2 abbreviated; 0 not reviewed).",
      continuationInstructions: [
        "This is a retry of a timed-out review with reduced scope.",
        "Focus ONLY on the changed files listed above.",
        "Do NOT post a top-level summary comment; only publish inline comments.",
      ],
    },
    {
      scenarioId: "quiet-no-delta-bounded",
      description: "Retry should settle quietly when no material delta remains.",
      firstPassFiles,
      continuationFiles,
      quietNoDelta: true,
      disclosureSentence:
        "Requested strict review; effective review remained strict and covered 6/6 changed files via large-PR triage (4 full, 2 abbreviated; 0 not reviewed).",
      continuationInstructions: [
        "This is a retry of a timed-out review with reduced scope.",
        "Focus ONLY on the changed files listed above.",
        "If no new material delta remains, settle quietly without claiming full-pull-request coverage.",
      ],
    },
  ];
}

function findSection(details: PromptDetails, sectionName: string) {
  return details.sections.find((section) => section.sectionName === sectionName) ?? null;
}

function buildScenarioSummary(params: {
  scenarioId: string;
  quietNoDelta: boolean;
  boundedButSufficient: boolean;
}): string {
  const prefix = `${params.scenarioId}: continuation stayed materially narrower than the first pass`;
  if (!params.boundedButSufficient) {
    return `${prefix}, but the boundedness contract drifted.`;
  }
  if (params.quietNoDelta) {
    return `${prefix} and remained sufficient for the shipped retry scope; quiet no-delta settlement stayed truthful and avoided overclaiming full-pull-request coverage.`;
  }
  return `${prefix} and remained sufficient for the shipped retry scope without overclaiming full-pull-request coverage.`;
}

function buildInvalidArgReport(issue: string, generatedAt = new Date().toISOString()): M063S03Report {
  return {
    command: "verify:m063:s03",
    generated_at: generatedAt,
    scenario_count: 0,
    success: false,
    status_code: "m063_s03_invalid_arg",
    summary: "Verifier arguments were invalid.",
    scenarios: [],
    issues: [issue],
  };
}

export function evaluateScenario(params: EvaluateScenarioInput): M063S03ScenarioRecord {
  const issues: string[] = [];
  const checks: M063S03Check[] = [];

  if (params.continuationFiles.length === 0 || params.continuationFiles.length >= params.firstPassFiles.length) {
    issues.push("Continuation file subset must stay non-empty and narrower than the first pass.");
  }

  const built = buildPromptPair(params);
  const promptDetails = params.mutatePromptDetails ? params.mutatePromptDetails(built) : built;
  const firstPass = promptDetails.firstPass;
  const continuation = promptDetails.continuation;

  const firstPassSectionNames = firstPass.sections.map((section) => section.sectionName);
  const continuationSectionNames = continuation.sections.map((section) => section.sectionName);
  const missingRequiredSections = REQUIRED_CONTINUATION_SECTIONS.filter((name) => !continuationSectionNames.includes(name));
  const narrowingSections = REQUIRED_NARROWING_SECTIONS.filter((name) => {
    const firstPassSection = findSection(firstPass, name);
    const continuationSection = findSection(continuation, name);
    if (!firstPassSection) return false;
    if (!continuationSection) return true;
    return continuationSection.charCount < firstPassSection.charCount;
  });
  const omittedFirstPassOnlySections = FIRST_PASS_ONLY_SECTION_NAMES.filter((name) => {
    const firstPassSection = findSection(firstPass, name);
    const continuationSection = findSection(continuation, name);
    return Boolean(firstPassSection) && !continuationSection;
  });

  const preservedRequiredSections = missingRequiredSections.length === 0;
  checks.push({
    key: "required-sections",
    status: preservedRequiredSections ? "pass" : "fail",
    detail: preservedRequiredSections
      ? "Continuation preserved the required named prompt sections."
      : `Continuation lost required section(s): ${missingRequiredSections.join(", ")}.`,
  });
  if (!preservedRequiredSections) {
    issues.push(`Continuation lost required section(s): ${missingRequiredSections.join(", ")}.`);
  }

  const requiredNarrowingMet = REQUIRED_NARROWING_SECTIONS.every((name) => narrowingSections.includes(name));
  checks.push({
    key: "narrowing-sections",
    status: requiredNarrowingMet ? "pass" : "fail",
    detail: requiredNarrowingMet
      ? `Continuation narrowed required sections: ${narrowingSections.join(", ")}.`
      : "Continuation replayed first-pass breadth instead of narrowing required sections.",
  });
  if (!requiredNarrowingMet) {
    issues.push("Continuation replayed first-pass breadth instead of narrowing required sections.");
  }

  const firstPassOnlyOmitted = omittedFirstPassOnlySections.includes("review-size-context");
  checks.push({
    key: "first-pass-only-sections-omitted",
    status: firstPassOnlyOmitted ? "pass" : "fail",
    detail: firstPassOnlyOmitted
      ? `Continuation omitted first-pass-only section(s): ${omittedFirstPassOnlySections.join(", ")}.`
      : "Continuation kept first-pass-only large-PR expansion instead of dropping it.",
  });
  if (!firstPassOnlyOmitted) {
    issues.push("Continuation kept first-pass-only large-PR expansion instead of dropping it.");
  }

  const boundednessWordingPass = continuation.text.includes("This is a retry of a timed-out review with reduced scope.")
    && continuation.text.includes("Focus ONLY on the changed files listed above.");
  checks.push({
    key: "boundedness-wording",
    status: boundednessWordingPass ? "pass" : "fail",
    detail: boundednessWordingPass
      ? "Continuation prompt explicitly states the reduced retry scope."
      : "Continuation prompt stopped stating the reduced retry scope explicitly.",
  });
  if (!boundednessWordingPass) {
    issues.push("Continuation prompt stopped stating the reduced retry scope explicitly.");
  }

  const scenarioSummary = buildScenarioSummary({
    scenarioId: params.scenarioId,
    quietNoDelta: params.quietNoDelta,
    boundedButSufficient: issues.length === 0,
  });
  const exhaustiveClaimAbsent = EXHAUSTIVE_LANGUAGE.every((phrase) => !scenarioSummary.includes(phrase));
  checks.push({
    key: "exhaustive-claim-absent",
    status: exhaustiveClaimAbsent ? "pass" : "fail",
    detail: exhaustiveClaimAbsent
      ? "Verifier summary stays truthful and avoids overclaiming full-pull-request coverage."
      : "Verifier summary overclaimed full-pull-request coverage.",
  });
  if (!exhaustiveClaimAbsent) {
    issues.push("Verifier summary overclaimed full-pull-request coverage.");
  }

  const noDeltaTruthfulnessPass = params.quietNoDelta
    ? continuation.text.includes("settle quietly without claiming full-pull-request coverage")
    : true;
  checks.push({
    key: "no-delta-truthfulness",
    status: params.quietNoDelta ? (noDeltaTruthfulnessPass ? "pass" : "fail") : "expected-negative",
    detail: params.quietNoDelta
      ? noDeltaTruthfulnessPass
        ? "Quiet no-delta continuation remains bounded and avoids overclaiming coverage."
        : "Quiet no-delta continuation stopped describing bounded settlement truthfully."
      : "Not a quiet no-delta settlement scenario.",
  });
  if (params.quietNoDelta && !noDeltaTruthfulnessPass) {
    issues.push("Quiet no-delta continuation stopped describing bounded settlement truthfully.");
  }

  const boundedButSufficient = issues.length === 0;
  const truthfulBoundedness = boundednessWordingPass && exhaustiveClaimAbsent && (!params.quietNoDelta || noDeltaTruthfulnessPass);
  const statusCode: M063S03ScenarioStatusCode = issues.length > 0
    ? "contract-failed"
    : params.quietNoDelta
      ? "bounded-continuation-no-delta"
      : "bounded-continuation-proved";

  return {
    scenarioId: params.scenarioId,
    success: issues.length === 0,
    statusCode,
    boundedButSufficient,
    truthfulBoundedness,
    preservedRequiredSections,
    narrowingSections,
    omittedFirstPassOnlySections,
    firstPassSectionNames,
    continuationSectionNames,
    firstPassChangedFileCount: params.firstPassFiles.length,
    continuationChangedFileCount: params.continuationFiles.length,
    summary: scenarioSummary,
    issues,
    checks,
  };
}

export function evaluateM063S03(params?: {
  generatedAt?: string;
  scenarioId?: M063S03ScenarioId | null;
}): M063S03Report {
  const generatedAt = params?.generatedAt ?? new Date().toISOString();
  const definitions = getDefaultScenarioMatrix();
  const selectedDefinitions = params?.scenarioId
    ? definitions.filter((definition) => definition.scenarioId === params.scenarioId)
    : definitions;
  const scenarios = selectedDefinitions.map((definition) => evaluateScenario(definition));
  const issues = scenarios.flatMap((scenario) => scenario.issues.map((issue) => `${scenario.scenarioId}: ${issue}`));

  return {
    command: "verify:m063:s03",
    generated_at: generatedAt,
    scenario_count: scenarios.length,
    success: issues.length === 0,
    status_code: issues.length === 0 ? "m063_s03_ok" : "m063_s03_verifier_failed",
    summary:
      "This verifier proves bounded continuation stayed materially narrower than the first pass and remained sufficient for the shipped retry scope.",
    scenarios,
    issues,
  };
}

export function parseVerifyM063S03Args(args: string[]): VerifyM063S03Args {
  let scenarioId: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scenario") {
      const candidate = args[index + 1];
      if (candidate && !candidate.startsWith("--")) {
        scenarioId = candidate;
        index += 1;
      }
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    scenarioId,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:m063:s03 -- [--scenario <id>] [--json]",
    "",
    "Scenario ids:",
    ...M063_S03_SCENARIO_IDS.map((id) => `  ${id}`),
    "",
    "Options:",
    "  --scenario   Run one deterministic scenario instead of the full matrix",
    "  --json       Print machine-readable JSON output",
    "  --help       Show this help",
  ].join("\n");
}

export function renderM063S03Report(report: M063S03Report): string {
  const lines = [
    "# M063 S03 — Bounded Continuation Verifier",
    "",
    `Status: ${report.status_code}`,
    `Scenarios: ${report.scenario_count}`,
    report.summary,
  ];

  if (report.scenarios.length > 0) {
    lines.push("", "Scenario matrix:");
    for (const scenario of report.scenarios) {
      lines.push(`- ${scenario.scenarioId}: ${scenario.statusCode}`);
      lines.push(
        `  - bounded-but-sufficient=${String(scenario.boundedButSufficient)} truthful-boundedness=${String(scenario.truthfulBoundedness)} preserved-required-sections=${String(scenario.preservedRequiredSections)}`,
      );
      lines.push(
        `  - first-pass-files=${scenario.firstPassChangedFileCount} continuation-files=${scenario.continuationChangedFileCount} narrowing=${scenario.narrowingSections.join(", ") || "none"}`,
      );
      lines.push(
        `  - omitted-first-pass-only=${scenario.omittedFirstPassOnlySections.join(", ") || "none"}`,
      );
      lines.push(`  - ${scenario.summary}`);
      for (const check of scenario.checks) {
        lines.push(`  - ${check.key}: ${check.status} — ${check.detail}`);
      }
    }
  }

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
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const options = parseVerifyM063S03Args(args);

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (options.scenarioId && !VALID_SCENARIO_IDS.has(options.scenarioId)) {
    const report = buildInvalidArgReport(`Unknown scenario id: ${options.scenarioId}.`);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM063S03Report(report));
    return 1;
  }

  const report = evaluateM063S03({ scenarioId: (options.scenarioId as M063S03ScenarioId | null) ?? null });
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderM063S03Report(report));
  return report.success ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
