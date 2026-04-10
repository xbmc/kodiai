import {
  projectContributorExperienceContract,
  resolveContributorExperienceRetrievalHint,
  type ContributorExperienceContract,
  type ContributorExperienceContractState,
} from "../src/contributor/experience-contract.ts";
import {
  buildRetrievalVariants,
  type BuildRetrievalVariantsInput,
  type MultiQueryVariant,
} from "../src/knowledge/multi-query-retrieval.ts";
import {
  buildRetrievalQuery,
  type RetrievalQuerySignals,
} from "../src/knowledge/retrieval-query.ts";
import {
  M045_S01_SCENARIO_IDS,
  evaluateM045S01,
  type EvaluationReport as M045S01EvaluationReport,
} from "./verify-m045-s01.ts";

export const M045_S03_CHECK_IDS = [
  "M045-S03-S01-REPORT-COMPOSED",
  "M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT",
  "M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT",
] as const;

export type M045S03CheckId = (typeof M045_S03_CHECK_IDS)[number];
export type RetrievalScenarioId = (typeof M045_S01_SCENARIO_IDS)[number];

type RetrievalSurfaceKind = "multi-query" | "legacy-query";

type RetrievalPhraseExpectations = {
  requiredMultiQueryPhrases: readonly string[];
  bannedMultiQueryPhrases: readonly string[];
  requiredLegacyPhrases: readonly string[];
  bannedLegacyPhrases: readonly string[];
};

export type RetrievalSurfaceSummary = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  query: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type RetrievalScenarioReport = {
  scenarioId: RetrievalScenarioId;
  description: string;
  contractState: ContributorExperienceContractState;
  authorHint: string | null;
  multiQuery: RetrievalSurfaceSummary;
  legacyQuery: RetrievalSurfaceSummary;
};

export type RetrievalFixture = {
  scenarioId: RetrievalScenarioId;
  description: string;
  contract: ContributorExperienceContract;
  multiQueryInput: BuildRetrievalVariantsInput;
  legacySignals: RetrievalQuerySignals;
  expectations: RetrievalPhraseExpectations;
};

export type Check = {
  id: M045S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: "verify:m045:s03";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  githubReview: M045S01EvaluationReport | null;
  retrieval: {
    scenarios: RetrievalScenarioReport[];
  };
  checks: Check[];
};

type SurfaceDrift = {
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

const APPROVED_RETRIEVAL_HINTS = [
  "new contributor",
  "developing contributor",
  "established contributor",
  "senior contributor",
  "returning contributor",
] as const;

const RAW_TIER_VOCABULARY = [
  "first-time",
  "newcomer",
  "regular",
  "core",
  "senior",
] as const;

const BASE_RETRIEVAL_TITLE = "Verify contributor contract retrieval alignment";
const BASE_RETRIEVAL_BODY =
  "Ensure retrieval hint wording stays aligned with contributor-experience contract states.";
const BASE_RETRIEVAL_TYPE = "test";
const BASE_RETRIEVAL_LANGUAGES = ["TypeScript"];
const BASE_RETRIEVAL_RISK_SIGNALS = ["verifier-drift"];
const BASE_RETRIEVAL_FILE_PATHS = [
  "src/contributor/experience-contract.ts",
  "src/knowledge/multi-query-retrieval.ts",
  "src/knowledge/retrieval-query.ts",
];

function toStatusPrefix(scenarioId: RetrievalScenarioId): string {
  return scenarioId.replace(/-/g, "_");
}

function findMissing(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => !text.includes(phrase));
}

function findUnexpected(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function collectSurfaceDrift(
  text: string,
  requiredPhrases: readonly string[],
  bannedPhrases: readonly string[],
): SurfaceDrift {
  return {
    missingPhrases: findMissing(text, requiredPhrases),
    unexpectedPhrases: findUnexpected(text, bannedPhrases),
  };
}

function buildRetrievalDetail(params: {
  scenarioId: RetrievalScenarioId;
  contractState: ContributorExperienceContractState;
  surface: RetrievalSurfaceKind;
  drift: SurfaceDrift;
  problems: string[];
}): string {
  const parts = [
    `scenario=${params.scenarioId}`,
    `contractState=${params.contractState}`,
    `surface=${params.surface}`,
  ];

  if (params.problems.length > 0) {
    parts.push(...params.problems);
  }
  if (params.drift.missingPhrases.length > 0) {
    parts.push(`missing required phrases: ${params.drift.missingPhrases.join(", ")}`);
  }
  if (params.drift.unexpectedPhrases.length > 0) {
    parts.push(`unexpected phrases present: ${params.drift.unexpectedPhrases.join(", ")}`);
  }

  return parts.join("; ");
}

function buildHintExpectations(
  contractState: ContributorExperienceContractState,
  authorHint: string | null,
): RetrievalPhraseExpectations {
  if (
    (contractState === "profile-backed" || contractState === "coarse-fallback") &&
    authorHint
  ) {
    const otherHints = APPROVED_RETRIEVAL_HINTS.filter((hint) => hint !== authorHint);
    return {
      requiredMultiQueryPhrases: [`author: ${authorHint}`],
      bannedMultiQueryPhrases: otherHints.map((hint) => `author: ${hint}`),
      requiredLegacyPhrases: [`Author: ${authorHint}`],
      bannedLegacyPhrases: otherHints.map((hint) => `Author: ${hint}`),
    };
  }

  return {
    requiredMultiQueryPhrases: [],
    bannedMultiQueryPhrases: [
      "author:",
      ...APPROVED_RETRIEVAL_HINTS,
      ...RAW_TIER_VOCABULARY,
    ],
    requiredLegacyPhrases: [],
    bannedLegacyPhrases: [
      "Author:",
      ...APPROVED_RETRIEVAL_HINTS,
      ...RAW_TIER_VOCABULARY,
    ],
  };
}

function buildRetrievalFixture(params: {
  scenarioId: RetrievalScenarioId;
  description: string;
  contract: ContributorExperienceContract;
}): RetrievalFixture {
  const authorHint = resolveContributorExperienceRetrievalHint(params.contract);

  return {
    scenarioId: params.scenarioId,
    description: params.description,
    contract: params.contract,
    multiQueryInput: {
      title: BASE_RETRIEVAL_TITLE,
      body: BASE_RETRIEVAL_BODY,
      conventionalType: BASE_RETRIEVAL_TYPE,
      prLanguages: [...BASE_RETRIEVAL_LANGUAGES],
      riskSignals: [...BASE_RETRIEVAL_RISK_SIGNALS],
      filePaths: [...BASE_RETRIEVAL_FILE_PATHS],
      authorHint: authorHint ?? undefined,
    },
    legacySignals: {
      prTitle: BASE_RETRIEVAL_TITLE,
      prBody: BASE_RETRIEVAL_BODY,
      conventionalType: BASE_RETRIEVAL_TYPE,
      detectedLanguages: [...BASE_RETRIEVAL_LANGUAGES],
      riskSignals: [...BASE_RETRIEVAL_RISK_SIGNALS],
      topFilePaths: [...BASE_RETRIEVAL_FILE_PATHS],
      authorHint: authorHint ?? undefined,
    },
    expectations: buildHintExpectations(params.contract.state, authorHint),
  };
}

export function buildM045S03RetrievalFixtures(): RetrievalFixture[] {
  return [
    buildRetrievalFixture({
      scenarioId: "profile-backed",
      description: "Profile-backed retrieval keeps the established contributor hint.",
      contract: projectContributorExperienceContract({
        source: "contributor-profile",
        tier: "established",
      }),
    }),
    buildRetrievalFixture({
      scenarioId: "coarse-fallback",
      description: "Coarse fallback retrieval uses only the approved returning contributor hint.",
      contract: projectContributorExperienceContract({
        source: "author-cache",
        tier: "core",
      }),
    }),
    buildRetrievalFixture({
      scenarioId: "generic-unknown",
      description: "Unknown contributor state stays generic with no retrieval author hint.",
      contract: projectContributorExperienceContract({
        source: "none",
        tier: null,
      }),
    }),
    buildRetrievalFixture({
      scenarioId: "generic-opt-out",
      description: "Opted-out contributors suppress retrieval author hints.",
      contract: projectContributorExperienceContract({
        source: "contributor-profile",
        tier: "established",
        optedOut: true,
      }),
    }),
    buildRetrievalFixture({
      scenarioId: "generic-degraded",
      description: "Degraded fallback search stays generic for retrieval hints.",
      contract: projectContributorExperienceContract({
        source: "github-search",
        tier: "regular",
        degraded: true,
        degradationPath: "search-api-rate-limit",
      }),
    }),
  ];
}

function evaluateMultiQueryScenario(params: {
  fixture: RetrievalFixture;
  _buildRetrievalVariants?: (input: BuildRetrievalVariantsInput) => MultiQueryVariant[];
}): RetrievalSurfaceSummary {
  const variants = params._buildRetrievalVariants
    ? params._buildRetrievalVariants(params.fixture.multiQueryInput)
    : buildRetrievalVariants(params.fixture.multiQueryInput);
  const intentVariant = variants.find((variant) => variant.type === "intent");
  const query = intentVariant?.query ?? "";
  const drift = collectSurfaceDrift(
    query,
    params.fixture.expectations.requiredMultiQueryPhrases,
    params.fixture.expectations.bannedMultiQueryPhrases,
  );
  const problems: string[] = [];

  if (!Array.isArray(variants) || variants.length === 0) {
    problems.push("multi-query builder returned no variants");
  }
  if (!intentVariant) {
    problems.push("intent variant was not rendered");
  }
  if (!query.trim()) {
    problems.push("query text was empty");
  }

  const passed =
    problems.length === 0 &&
    drift.missingPhrases.length === 0 &&
    drift.unexpectedPhrases.length === 0;

  return {
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.fixture.scenarioId)}_retrieval_multi_query_truthful`
      : "retrieval_multi_query_contract_truthfulness_failed",
    detail: buildRetrievalDetail({
      scenarioId: params.fixture.scenarioId,
      contractState: params.fixture.contract.state,
      surface: "multi-query",
      drift,
      problems,
    }),
    query,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

function evaluateLegacyQueryScenario(params: {
  fixture: RetrievalFixture;
  _buildRetrievalQuery?: (signals: RetrievalQuerySignals) => string;
}): RetrievalSurfaceSummary {
  const query = params._buildRetrievalQuery
    ? params._buildRetrievalQuery(params.fixture.legacySignals)
    : buildRetrievalQuery(params.fixture.legacySignals);
  const drift = collectSurfaceDrift(
    query,
    params.fixture.expectations.requiredLegacyPhrases,
    params.fixture.expectations.bannedLegacyPhrases,
  );
  const problems: string[] = [];

  if (!query.trim()) {
    problems.push("query text was empty");
  }

  const passed =
    problems.length === 0 &&
    drift.missingPhrases.length === 0 &&
    drift.unexpectedPhrases.length === 0;

  return {
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.fixture.scenarioId)}_retrieval_legacy_query_truthful`
      : "retrieval_legacy_query_contract_truthfulness_failed",
    detail: buildRetrievalDetail({
      scenarioId: params.fixture.scenarioId,
      contractState: params.fixture.contract.state,
      surface: "legacy-query",
      drift,
      problems,
    }),
    query,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

function validateEmbeddedS01Report(report: unknown): {
  report: M045S01EvaluationReport | null;
  problems: string[];
} {
  if (!report || typeof report !== "object") {
    return {
      report: null,
      problems: ["embedded S01 report was missing or non-object"],
    };
  }

  const candidate = report as Partial<M045S01EvaluationReport>;
  const problems: string[] = [];

  if (candidate.command !== "verify:m045:s01") {
    problems.push(`embedded command=${String(candidate.command)} expected verify:m045:s01`);
  }
  if (!Array.isArray(candidate.check_ids) || candidate.check_ids.length === 0) {
    problems.push("embedded check_ids were missing");
  }
  if (!Array.isArray(candidate.checks) || candidate.checks.length === 0) {
    problems.push("embedded checks were missing");
  } else if (
    candidate.checks.some(
      (check) =>
        !check ||
        typeof check !== "object" ||
        typeof check.id !== "string" ||
        typeof check.status_code !== "string",
    )
  ) {
    problems.push("embedded checks were malformed");
  }
  if (!Array.isArray(candidate.scenarios) || candidate.scenarios.length === 0) {
    problems.push("embedded scenario data was missing");
  } else if (
    candidate.scenarios.some(
      (scenario) =>
        !scenario ||
        typeof scenario !== "object" ||
        typeof scenario.scenarioId !== "string" ||
        !scenario.prompt ||
        typeof scenario.prompt.statusCode !== "string" ||
        !scenario.reviewDetails ||
        typeof scenario.reviewDetails.statusCode !== "string",
    )
  ) {
    problems.push("embedded scenario data was malformed");
  }

  return {
    report: problems.length === 0 ? (candidate as M045S01EvaluationReport) : null,
    problems,
  };
}

function buildEmbeddedGitHubCheck(params: {
  report: M045S01EvaluationReport | null;
  problems: string[];
}): Check {
  if (params.problems.length > 0 || !params.report) {
    return {
      id: "M045-S03-S01-REPORT-COMPOSED",
      passed: false,
      skipped: false,
      status_code: "embedded_s01_report_drift",
      detail: params.problems.join("; "),
    };
  }

  const failingNestedChecks = params.report.checks
    .filter((check) => !check.passed && !check.skipped)
    .map((check) => `${check.id}:${check.status_code}`);

  if (failingNestedChecks.length > 0 || !params.report.overallPassed) {
    return {
      id: "M045-S03-S01-REPORT-COMPOSED",
      passed: false,
      skipped: false,
      status_code: "embedded_s01_report_failed",
      detail: `embedded S01 report failed: ${failingNestedChecks.join(", ")}`,
    };
  }

  return {
    id: "M045-S03-S01-REPORT-COMPOSED",
    passed: true,
    skipped: false,
    status_code: "embedded_s01_report_preserved",
    detail: `embedded ${params.report.checks.length} S01 checks across ${params.report.scenarios.length} scenarios`,
  };
}

function buildRetrievalSurfaceCheck(params: {
  id: Extract<
    M045S03CheckId,
    "M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT" | "M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT"
  >;
  scenarios: RetrievalScenarioReport[];
  surface: RetrievalSurfaceKind;
}): Check {
  const failingScenarios = params.scenarios.filter((scenario) =>
    params.surface === "multi-query" ? !scenario.multiQuery.passed : !scenario.legacyQuery.passed
  );

  if (failingScenarios.length === 0) {
    return {
      id: params.id,
      passed: true,
      skipped: false,
      status_code:
        params.surface === "multi-query"
          ? "retrieval_multi_query_contract_truthful"
          : "retrieval_legacy_query_contract_truthful",
      detail: `checked ${params.scenarios.length} retrieval scenarios`,
    };
  }

  return {
    id: params.id,
    passed: false,
    skipped: false,
    status_code:
      params.surface === "multi-query"
        ? "retrieval_multi_query_contract_drift"
        : "retrieval_legacy_query_contract_drift",
    detail: `failing scenarios: ${failingScenarios.map((scenario) => scenario.scenarioId).join(", ")}`,
  };
}

export async function evaluateM045S03(opts?: {
  generatedAt?: string;
  _evaluateS01?: () => Promise<unknown>;
  _retrievalFixtures?: RetrievalFixture[];
  _buildRetrievalVariants?: (input: BuildRetrievalVariantsInput) => MultiQueryVariant[];
  _buildRetrievalQuery?: (signals: RetrievalQuerySignals) => string;
}): Promise<EvaluationReport> {
  const generatedAt = opts?.generatedAt ?? new Date().toISOString();

  let embeddedUnknown: unknown;
  let embeddedProblems: string[] = [];
  try {
    embeddedUnknown = opts?._evaluateS01 ? await opts._evaluateS01() : await evaluateM045S01();
  } catch (error) {
    embeddedProblems = [
      `embedded S01 evaluation threw: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const validatedEmbedded = embeddedProblems.length > 0
    ? { report: null, problems: embeddedProblems }
    : validateEmbeddedS01Report(embeddedUnknown);

  const fixtures = opts?._retrievalFixtures ?? buildM045S03RetrievalFixtures();
  const retrievalScenarios = fixtures.map((fixture) => ({
    scenarioId: fixture.scenarioId,
    description: fixture.description,
    contractState: fixture.contract.state,
    authorHint: resolveContributorExperienceRetrievalHint(fixture.contract),
    multiQuery: evaluateMultiQueryScenario({
      fixture,
      _buildRetrievalVariants: opts?._buildRetrievalVariants,
    }),
    legacyQuery: evaluateLegacyQueryScenario({
      fixture,
      _buildRetrievalQuery: opts?._buildRetrievalQuery,
    }),
  }));

  const checks: Check[] = [
    buildEmbeddedGitHubCheck(validatedEmbedded),
    buildRetrievalSurfaceCheck({
      id: "M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT",
      scenarios: retrievalScenarios,
      surface: "multi-query",
    }),
    buildRetrievalSurfaceCheck({
      id: "M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT",
      scenarios: retrievalScenarios,
      surface: "legacy-query",
    }),
  ];

  return {
    command: "verify:m045:s03",
    generatedAt,
    check_ids: M045_S03_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    githubReview: validatedEmbedded.report,
    retrieval: {
      scenarios: retrievalScenarios,
    },
    checks,
  };
}

export function renderM045S03Report(report: EvaluationReport): string {
  const lines = [
    "M045 S03 proof harness: contributor-experience contract drift",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "GitHub review (embedded S01):",
  ];

  if (!report.githubReview) {
    lines.push("- missing embedded S01 report");
  } else {
    lines.push(
      `- embedded verdict: ${report.githubReview.overallPassed ? "PASS" : "FAIL"} scenarios=${report.githubReview.scenarios.length} checks=${report.githubReview.checks.length}`,
    );
    for (const scenario of report.githubReview.scenarios) {
      lines.push(
        `  - ${scenario.scenarioId} (contract=${scenario.contractState}) prompt=${scenario.prompt.passed ? "pass" : "fail"} review-details=${scenario.reviewDetails.passed ? "pass" : "fail"}`,
      );
    }
  }

  lines.push("Retrieval:");
  for (const scenario of report.retrieval.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} (contract=${scenario.contractState}) multi-query=${scenario.multiQuery.passed ? "pass" : "fail"} legacy-query=${scenario.legacyQuery.passed ? "pass" : "fail"}`,
    );
    if (!scenario.multiQuery.passed && scenario.multiQuery.detail) {
      lines.push(`  multi-query: ${scenario.multiQuery.detail}`);
    }
    if (!scenario.legacyQuery.passed && scenario.legacyQuery.detail) {
      lines.push(`  legacy-query: ${scenario.legacyQuery.detail}`);
    }
  }

  lines.push("Checks:");
  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  if (report.githubReview) {
    lines.push("Embedded GitHub checks:");
    for (const check of report.githubReview.checks) {
      const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
      lines.push(
        `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM045S03ProofHarness(opts?: {
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  json?: boolean;
  _evaluateS01?: () => Promise<unknown>;
  _retrievalFixtures?: RetrievalFixture[];
  _buildRetrievalVariants?: (input: BuildRetrievalVariantsInput) => MultiQueryVariant[];
  _buildRetrievalQuery?: (signals: RetrievalQuerySignals) => string;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM045S03({
    _evaluateS01: opts?._evaluateS01,
    _retrievalFixtures: opts?._retrievalFixtures,
    _buildRetrievalVariants: opts?._buildRetrievalVariants,
    _buildRetrievalQuery: opts?._buildRetrievalQuery,
  });

  if (opts?.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM045S03Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m045:s03 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM045S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
