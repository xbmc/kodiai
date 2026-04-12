import {
  buildReviewPrompt,
  SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
} from "../src/execution/review-prompt.ts";
import {
  projectContributorExperienceContract,
  type ContributorExperienceContract,
  type ContributorExperienceContractState,
} from "../src/contributor/experience-contract.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import type { ResolvedReviewProfile } from "../src/lib/auto-profile.ts";

const BASE_PROFILE_SELECTION: ResolvedReviewProfile = {
  selectedProfile: "balanced",
  source: "auto",
  linesChanged: 60,
  autoBand: null,
};

export const M045_S01_SCENARIO_IDS = [
  "profile-backed",
  "coarse-fallback",
  "generic-unknown",
  "generic-opt-out",
  "generic-degraded",
] as const;

export type GitHubReviewContractScenarioId =
  (typeof M045_S01_SCENARIO_IDS)[number];

type GitHubReviewContractSurfaceExpectations = {
  requiredPromptPhrases: readonly string[];
  bannedPromptPhrases: readonly string[];
  requiredReviewDetailsPhrases: readonly string[];
  bannedReviewDetailsPhrases: readonly string[];
};

export type GitHubReviewContractScenarioDefinition = {
  scenarioId: GitHubReviewContractScenarioId;
  description: string;
  contract: ContributorExperienceContract;
  expectations: GitHubReviewContractSurfaceExpectations;
  searchRateLimitDegradation?: {
    degraded: boolean;
    retryAttempts: number;
    skippedQueries: number;
    degradationPath: string;
  };
};

export type GitHubReviewContractFixture = {
  scenarioId: GitHubReviewContractScenarioId;
  description: string;
  contract: ContributorExperienceContract;
  promptAuthorSection: string;
  promptDegradationSection: string;
  promptSurfaceText: string;
  reviewDetailsBody: string;
  expectations: GitHubReviewContractSurfaceExpectations;
};

type SurfaceKind = "prompt" | "review-details";

type SurfaceDrift = {
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type Check = {
  id: string;
  scenarioId: GitHubReviewContractScenarioId;
  surface: SurfaceKind;
  contractState: ContributorExperienceContractState;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type ScenarioSurfaceSummary = {
  checkId: string;
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type ScenarioReport = {
  scenarioId: GitHubReviewContractScenarioId;
  description: string;
  contractState: ContributorExperienceContractState;
  contractSource: ContributorExperienceContract["source"];
  promptTier: ContributorExperienceContract["promptTier"];
  promptPolicyKind: ContributorExperienceContract["promptPolicy"]["kind"];
  degraded: boolean;
  degradationPath: string | null;
  expectations: GitHubReviewContractSurfaceExpectations;
  promptAuthorSection: string;
  promptDegradationSection: string;
  reviewDetailsBody: string;
  prompt: ScenarioSurfaceSummary;
  reviewDetails: ScenarioSurfaceSummary;
};

export type EvaluationReport = {
  command: "verify:m045:s01";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  scenarios: ScenarioReport[];
  checks: Check[];
};

const SCENARIO_DEFINITIONS: Record<
  GitHubReviewContractScenarioId,
  GitHubReviewContractScenarioDefinition
> = {
  "profile-backed": {
    scenarioId: "profile-backed",
    description: "Established contributor profiles keep explicitly profile-backed review behavior.",
    contract: projectContributorExperienceContract({
      source: "contributor-profile",
      tier: "established",
    }),
    expectations: {
      requiredPromptPhrases: [
        "Contributor-experience contract: profile-backed.",
        "established contributor",
        "Keep explanations brief",
      ],
      bannedPromptPhrases: [
        "first-time or new contributor",
        "developing contributor",
        "core/senior contributor",
        "Contributor-experience contract: coarse-fallback.",
        "Contributor-experience contract: generic-unknown.",
        "Contributor-experience contract: generic-opt-out.",
        "Contributor-experience contract: generic-degraded.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: profile-backed (using linked contributor profile guidance)",
      ],
      bannedReviewDetailsPhrases: [
        "coarse-fallback",
        "generic-unknown",
        "generic-opt-out",
        "generic-degraded",
        "- Author tier:",
      ],
    },
  },
  "coarse-fallback": {
    scenarioId: "coarse-fallback",
    description:
      "Low-confidence fallback signals stay coarse instead of overclaiming senior or profile-backed certainty.",
    contract: projectContributorExperienceContract({
      source: "author-cache",
      tier: "core",
    }),
    expectations: {
      requiredPromptPhrases: [
        "Contributor-experience contract: coarse-fallback.",
        "only coarse fallback signals",
      ],
      bannedPromptPhrases: [
        "first-time or new contributor",
        "developing contributor",
        "established contributor",
        "core/senior contributor",
        "The author has deep expertise in",
        "Contributor-experience contract: profile-backed.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        "generic-unknown",
        "generic-opt-out",
        "generic-degraded",
        "- Author tier:",
        "Profile ID:",
        "Slack ID:",
        "expertise score",
      ],
    },
  },
  "generic-unknown": {
    scenarioId: "generic-unknown",
    description:
      "Missing contributor signals keep the review surface generic and non-contradictory.",
    contract: projectContributorExperienceContract({
      source: "none",
      tier: null,
    }),
    expectations: {
      requiredPromptPhrases: [
        "Contributor-experience contract: generic-unknown.",
        "No reliable contributor signal is available for the PR author (",
      ],
      bannedPromptPhrases: [
        "first-time or new contributor",
        "developing contributor",
        "established contributor",
        "core/senior contributor",
        "Contributor-experience contract: profile-backed.",
        "Contributor-experience contract: coarse-fallback.",
        "Contributor-experience contract: generic-opt-out.",
        "Contributor-experience contract: generic-degraded.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: generic-unknown (no reliable contributor signal available)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        "coarse-fallback",
        "generic-opt-out",
        "generic-degraded",
        "- Author tier:",
        "Profile ID:",
        "Slack ID:",
        "expertise score",
      ],
    },
  },
  "generic-opt-out": {
    scenarioId: "generic-opt-out",
    description:
      "Opted-out contributors keep contributor-specific behavior disabled across prompt and Review Details.",
    contract: projectContributorExperienceContract({
      source: "contributor-profile",
      tier: "established",
      optedOut: true,
    }),
    expectations: {
      requiredPromptPhrases: [
        "Contributor-experience contract: generic-opt-out.",
        "Contributor-specific guidance is disabled by opt-out",
      ],
      bannedPromptPhrases: [
        "first-time or new contributor",
        "developing contributor",
        "established contributor",
        "core/senior contributor",
        "Contributor-experience contract: profile-backed.",
        "Contributor-experience contract: coarse-fallback.",
        "Contributor-experience contract: generic-unknown.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: generic-opt-out (contributor-specific guidance disabled by opt-out)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        "coarse-fallback",
        "generic-unknown",
        "generic-degraded",
        "- Author tier:",
        "Profile ID:",
        "Slack ID:",
        "expertise score",
      ],
    },
  },
  "generic-degraded": {
    scenarioId: "generic-degraded",
    description:
      "Degraded fallback search stays generic, discloses rate limiting, and never overclaims contributor certainty.",
    contract: projectContributorExperienceContract({
      source: "github-search",
      tier: "regular",
      degraded: true,
      degradationPath: "search-api-rate-limit",
    }),
    searchRateLimitDegradation: {
      degraded: true,
      retryAttempts: 1,
      skippedQueries: 1,
      degradationPath: "search-api-rate-limit",
    },
    expectations: {
      requiredPromptPhrases: [
        "Contributor-experience contract: generic-degraded.",
        "Fallback contributor signals are unavailable for the PR author (",
        "## Search API Degradation Context",
        SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
      ],
      bannedPromptPhrases: [
        "first-time or new contributor",
        "developing contributor",
        "established contributor",
        "core/senior contributor",
        "Contributor-experience contract: profile-backed.",
        "Contributor-experience contract: coarse-fallback.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: generic-degraded (fallback signals unavailable: search-api-rate-limit)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        "coarse-fallback",
        "generic-unknown",
        "generic-opt-out",
        "- Author tier:",
        "Profile ID:",
        "Slack ID:",
        "expertise score",
      ],
    },
  },
};

export const M045_S01_CHECK_IDS = M045_S01_SCENARIO_IDS.flatMap((scenarioId) => [
  toCheckId(scenarioId, "prompt"),
  toCheckId(scenarioId, "review-details"),
]) as readonly string[];

export function getGitHubReviewContractScenario(
  scenarioId: GitHubReviewContractScenarioId,
): GitHubReviewContractScenarioDefinition {
  return SCENARIO_DEFINITIONS[scenarioId];
}

function toCheckId(
  scenarioId: GitHubReviewContractScenarioId,
  surface: SurfaceKind,
): string {
  return `M045-S01-${scenarioId.toUpperCase()}-${surface === "prompt" ? "PROMPT" : "DETAILS"}-TRUTHFUL`;
}

function createStatusCodePrefix(scenarioId: GitHubReviewContractScenarioId): string {
  return scenarioId.replace(/-/g, "_");
}

function basePromptContext(overrides?: {
  prAuthor?: string;
  contributorExperienceContract?: ContributorExperienceContract;
  searchRateLimitDegradation?: {
    degraded: boolean;
    retryAttempts: number;
    skippedQueries: number;
    degradationPath: string;
  };
}) {
  return {
    owner: "xbmc",
    repo: "xbmc",
    prNumber: 4245,
    prTitle: "Verify GitHub contributor-experience contract matrix",
    prBody:
      "Ensure prompt and Review Details stay truthful for all supported contributor-experience contract states.",
    prAuthor: overrides?.prAuthor ?? "octocat",
    baseBranch: "master",
    headBranch: "kodiai/verify-m045-s01",
    changedFiles: ["xbmc/utils/StringUtils.cpp"],
    mode: "standard" as const,
    severityMinLevel: "medium" as const,
    maxComments: 7,
    focusAreas: [],
    ignoredAreas: ["style"],
    suppressions: [],
    minConfidence: 0,
    contributorExperienceContract: overrides?.contributorExperienceContract,
    searchRateLimitDegradation: overrides?.searchRateLimitDegradation,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractPromptSection(prompt: string, heading: string): string {
  const match = prompt.match(
    new RegExp(`## ${escapeRegExp(heading)}[\\s\\S]*?(?=\\n## |$)`),
  );
  return match?.[0] ?? "";
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

function buildDetail(params: {
  scenarioId: GitHubReviewContractScenarioId;
  contractState: ContributorExperienceContractState;
  surface: SurfaceKind;
  drift: SurfaceDrift;
  problems: string[];
}): string {
  const detailParts = [
    `scenario=${params.scenarioId}`,
    `contractState=${params.contractState}`,
    `surface=${params.surface}`,
  ];

  if (params.problems.length > 0) {
    detailParts.push(...params.problems);
  }

  if (params.drift.missingPhrases.length > 0) {
    detailParts.push(
      `missing required ${params.surface === "prompt" ? "prompt" : "review-details"} phrases: ${params.drift.missingPhrases.join(", ")}`,
    );
  }

  if (params.drift.unexpectedPhrases.length > 0) {
    detailParts.push(
      `unexpected ${params.surface === "prompt" ? "prompt" : "review-details"} phrases present: ${params.drift.unexpectedPhrases.join(
        ", ",
      )}`,
    );
  }

  return detailParts.join("; ");
}

export function buildGitHubReviewContractFixture(params: {
  scenarioId: GitHubReviewContractScenarioId;
  prAuthor?: string;
  contract?: ContributorExperienceContract;
  searchRateLimitDegradation?: {
    degraded: boolean;
    retryAttempts: number;
    skippedQueries: number;
    degradationPath: string;
  };
}): GitHubReviewContractFixture {
  const scenario = getGitHubReviewContractScenario(params.scenarioId);
  const contract = params.contract ?? scenario.contract;
  const searchRateLimitDegradation =
    params.searchRateLimitDegradation ?? scenario.searchRateLimitDegradation;

  const prompt = buildReviewPrompt(
    basePromptContext({
      prAuthor: params.prAuthor,
      contributorExperienceContract: contract,
      searchRateLimitDegradation,
    }),
  );

  const promptAuthorSection = extractPromptSection(prompt, "Author Experience Context");
  const promptDegradationSection = extractPromptSection(prompt, "Search API Degradation Context");
  const promptSurfaceText = [promptAuthorSection, promptDegradationSection]
    .filter(Boolean)
    .join("\n\n") || prompt;

  const reviewDetailsBody = formatReviewDetailsSummary({
    reviewOutputKey: `m045-s01-${params.scenarioId}`,
    filesReviewed: 1,
    linesAdded: 8,
    linesRemoved: 2,
    findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
    profileSelection: BASE_PROFILE_SELECTION,
    contributorExperience: contract.reviewDetails,
  });

  return {
    scenarioId: params.scenarioId,
    description: scenario.description,
    contract,
    promptAuthorSection,
    promptDegradationSection,
    promptSurfaceText,
    reviewDetailsBody,
    expectations: scenario.expectations,
  };
}

function evaluatePromptCheck(
  fixture: GitHubReviewContractFixture,
): Check {
  const scenario = getGitHubReviewContractScenario(fixture.scenarioId);
  const drift = collectSurfaceDrift(
    fixture.promptSurfaceText,
    scenario.expectations.requiredPromptPhrases,
    scenario.expectations.bannedPromptPhrases,
  );
  const problems: string[] = [];

  if (!fixture.promptSurfaceText.trim()) {
    problems.push("prompt surface was not rendered");
  }
  if (fixture.contract.state !== scenario.contract.state) {
    problems.push(`actual contract state ${fixture.contract.state} did not match expected ${scenario.contract.state}`);
  }

  const passed = problems.length === 0
    && drift.missingPhrases.length === 0
    && drift.unexpectedPhrases.length === 0;

  return {
    id: toCheckId(fixture.scenarioId, "prompt"),
    scenarioId: fixture.scenarioId,
    surface: "prompt",
    contractState: fixture.contract.state,
    passed,
    skipped: false,
    status_code: passed
      ? `${createStatusCodePrefix(fixture.scenarioId)}_prompt_contract_truthful`
      : "prompt_contract_truthfulness_failed",
    detail: buildDetail({
      scenarioId: fixture.scenarioId,
      contractState: fixture.contract.state,
      surface: "prompt",
      drift,
      problems,
    }),
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

function evaluateReviewDetailsCheck(
  fixture: GitHubReviewContractFixture,
): Check {
  const scenario = getGitHubReviewContractScenario(fixture.scenarioId);
  const drift = collectSurfaceDrift(
    fixture.reviewDetailsBody,
    scenario.expectations.requiredReviewDetailsPhrases,
    scenario.expectations.bannedReviewDetailsPhrases,
  );
  const problems: string[] = [];

  if (!fixture.reviewDetailsBody.trim()) {
    problems.push("review-details surface was not rendered");
  }
  if (fixture.contract.state !== scenario.contract.state) {
    problems.push(`actual contract state ${fixture.contract.state} did not match expected ${scenario.contract.state}`);
  }

  const passed = problems.length === 0
    && drift.missingPhrases.length === 0
    && drift.unexpectedPhrases.length === 0;

  return {
    id: toCheckId(fixture.scenarioId, "review-details"),
    scenarioId: fixture.scenarioId,
    surface: "review-details",
    contractState: fixture.contract.state,
    passed,
    skipped: false,
    status_code: passed
      ? `${createStatusCodePrefix(fixture.scenarioId)}_review_details_contract_truthful`
      : "review_details_contract_truthfulness_failed",
    detail: buildDetail({
      scenarioId: fixture.scenarioId,
      contractState: fixture.contract.state,
      surface: "review-details",
      drift,
      problems,
    }),
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

export async function runScenarioPromptTruthfulCheck(
  scenarioId: GitHubReviewContractScenarioId,
  _runFixture?: (
    scenarioId: GitHubReviewContractScenarioId,
  ) => GitHubReviewContractFixture,
): Promise<Check> {
  const fixture = _runFixture
    ? _runFixture(scenarioId)
    : buildGitHubReviewContractFixture({ scenarioId });
  return evaluatePromptCheck(fixture);
}

export async function runScenarioReviewDetailsTruthfulCheck(
  scenarioId: GitHubReviewContractScenarioId,
  _runFixture?: (
    scenarioId: GitHubReviewContractScenarioId,
  ) => GitHubReviewContractFixture,
): Promise<Check> {
  const fixture = _runFixture
    ? _runFixture(scenarioId)
    : buildGitHubReviewContractFixture({ scenarioId });
  return evaluateReviewDetailsCheck(fixture);
}

export async function evaluateM045S01(opts?: {
  _runFixture?: (
    scenarioId: GitHubReviewContractScenarioId,
  ) => GitHubReviewContractFixture;
  generatedAt?: string;
}): Promise<EvaluationReport> {
  const generatedAt = opts?.generatedAt ?? new Date().toISOString();
  const scenarios: ScenarioReport[] = [];
  const checks: Check[] = [];

  for (const scenarioId of M045_S01_SCENARIO_IDS) {
    const fixture = opts?._runFixture
      ? opts._runFixture(scenarioId)
      : buildGitHubReviewContractFixture({ scenarioId });
    const promptCheck = evaluatePromptCheck(fixture);
    const reviewDetailsCheck = evaluateReviewDetailsCheck(fixture);

    checks.push(promptCheck, reviewDetailsCheck);
    scenarios.push({
      scenarioId,
      description: fixture.description,
      contractState: fixture.contract.state,
      contractSource: fixture.contract.source,
      promptTier: fixture.contract.promptTier,
      promptPolicyKind: fixture.contract.promptPolicy.kind,
      degraded: fixture.contract.degraded,
      degradationPath: fixture.contract.degradationPath,
      expectations: fixture.expectations,
      promptAuthorSection: fixture.promptAuthorSection,
      promptDegradationSection: fixture.promptDegradationSection,
      reviewDetailsBody: fixture.reviewDetailsBody,
      prompt: {
        checkId: promptCheck.id,
        passed: promptCheck.passed,
        statusCode: promptCheck.status_code,
        detail: promptCheck.detail,
        missingPhrases: promptCheck.missingPhrases,
        unexpectedPhrases: promptCheck.unexpectedPhrases,
      },
      reviewDetails: {
        checkId: reviewDetailsCheck.id,
        passed: reviewDetailsCheck.passed,
        statusCode: reviewDetailsCheck.status_code,
        detail: reviewDetailsCheck.detail,
        missingPhrases: reviewDetailsCheck.missingPhrases,
        unexpectedPhrases: reviewDetailsCheck.unexpectedPhrases,
      },
    });
  }

  return {
    command: "verify:m045:s01",
    generatedAt,
    check_ids: M045_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    scenarios,
    checks,
  };
}

export function renderM045S01Report(report: EvaluationReport): string {
  const lines = [
    "M045 S01 proof harness: GitHub review contributor-experience contract",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Scenarios:",
  ];

  for (const scenario of report.scenarios) {
    const scenarioPassed = scenario.prompt.passed && scenario.reviewDetails.passed;
    lines.push(
      `- ${scenario.scenarioId} (contract=${scenario.contractState}) ${scenarioPassed ? "PASS" : "FAIL"} prompt=${scenario.prompt.passed ? "pass" : "fail"} review-details=${scenario.reviewDetails.passed ? "pass" : "fail"}`,
    );

    if (!scenario.prompt.passed && scenario.prompt.detail) {
      lines.push(`  prompt: ${scenario.prompt.detail}`);
    }
    if (!scenario.reviewDetails.passed && scenario.reviewDetails.detail) {
      lines.push(`  review-details: ${scenario.reviewDetails.detail}`);
    }
  }

  lines.push("Checks:");
  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM045S01ProofHarness(opts?: {
  _runFixture?: (
    scenarioId: GitHubReviewContractScenarioId,
  ) => GitHubReviewContractFixture;
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM045S01({ _runFixture: opts?._runFixture });

  if (opts?.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM045S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m045:s01 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM045S01ProofHarness({ json: useJson });
  process.exit(exitCode);
}
