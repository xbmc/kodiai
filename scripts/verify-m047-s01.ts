import type { Logger } from "pino";
import {
  buildReviewPrompt,
  SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
} from "../src/execution/review-prompt.ts";
import { formatReviewDetailsSummary } from "../src/lib/review-utils.ts";
import type { ResolvedReviewProfile } from "../src/lib/auto-profile.ts";
import {
  resolveReviewAuthorClassification,
  type ReviewAuthorClassification,
} from "../src/contributor/review-author-resolution.ts";
import {
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
  type ContributorProfileTrustReason,
  type ContributorProfileTrustState,
} from "../src/contributor/profile-trust.ts";
import type {
  ContributorProfile,
  ContributorProfileStore,
} from "../src/contributor/types.ts";
import type {
  ContributorExperienceContractState,
  ContributorExperienceSource,
} from "../src/contributor/experience-contract.ts";

const REFERENCE_TIME = new Date("2026-04-10T12:00:00.000Z");

const BASE_PROFILE_SELECTION: ResolvedReviewProfile = {
  selectedProfile: "balanced",
  source: "auto",
  linesChanged: 60,
  autoBand: null,
};

export const M047_S01_SCENARIO_IDS = [
  "linked-unscored",
  "legacy",
  "stale",
  "calibrated",
  "opt-out",
  "coarse-fallback-cache",
] as const;

export type M047S01ScenarioId = (typeof M047_S01_SCENARIO_IDS)[number];

type ScenarioExpectations = {
  trustState: ContributorProfileTrustState | null;
  trustReason: ContributorProfileTrustReason | null;
  calibrationMarker: string | null;
  calibrationVersion: string | null;
  contractState: ContributorExperienceContractState;
  contractSource: ContributorExperienceSource;
  fallbackPath: string;
  degradationPath: string | null;
  requiredPromptPhrases: readonly string[];
  bannedPromptPhrases: readonly string[];
  requiredReviewDetailsPhrases: readonly string[];
  bannedReviewDetailsPhrases: readonly string[];
};

type ScenarioDefinition = {
  scenarioId: M047S01ScenarioId;
  description: string;
  authorAssociation: string;
  contributorProfile?:
    | (Partial<ContributorProfile> & { overallTier?: string })
    | null;
  authorCache?: {
    tier: "first-time" | "regular" | "core";
    prCount: number;
  };
  searchPrCount?: number;
  searchError?: unknown;
  expectations: ScenarioExpectations;
};

export type Check = {
  id: string;
  scenarioId: M047S01ScenarioId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type ScenarioReport = {
  scenarioId: M047S01ScenarioId;
  description: string;
  trustState: ContributorProfileTrustState | null;
  trustReason: ContributorProfileTrustReason | null;
  calibrationMarker: string | null;
  calibrationVersion: string | null;
  contractState: ContributorExperienceContractState | null;
  contractSource: ContributorExperienceSource | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  promptSurfaceText: string;
  reviewDetailsBody: string;
  check: {
    checkId: string;
    passed: boolean;
    statusCode: string;
    detail?: string;
  };
};

export type ScenarioFixture = Omit<ScenarioReport, "check">;

export type EvaluationReport = {
  command: "verify:m047:s01";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  scenarios: ScenarioReport[];
  checks: Check[];
};

type MaybePromise<T> = T | Promise<T>;

type SurfaceDrift = {
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

const SHARED_REVIEW_DETAILS_BANNED_PHRASES = [
  "Profile ID:",
  "Slack ID:",
  "expertise score",
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
  "current-trust-marker",
] as const;

const SCENARIO_DEFINITIONS: Record<M047S01ScenarioId, ScenarioDefinition> = {
  "linked-unscored": {
    scenarioId: "linked-unscored",
    description:
      "A linked but never-scored stored row fails open to coarse fallback search guidance.",
    authorAssociation: "NONE",
    contributorProfile: {
      overallTier: "newcomer",
      overallScore: 0,
      lastScoredAt: null,
      trustMarker: null,
    },
    searchPrCount: 4,
    expectations: {
      trustState: "linked-unscored",
      trustReason: "never-scored",
      calibrationMarker: null,
      calibrationVersion: null,
      contractState: "coarse-fallback",
      contractSource: "github-search",
      fallbackPath: "stored-profile-linked-unscored->github-search",
      degradationPath: null,
      requiredPromptPhrases: [
        "Contributor-experience contract: coarse-fallback.",
        "only coarse fallback signals",
      ],
      bannedPromptPhrases: [
        "first-time or new contributor to this repository",
        "Contributor-experience contract: profile-backed.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        ...SHARED_REVIEW_DETAILS_BANNED_PHRASES,
      ],
    },
  },
  legacy: {
    scenarioId: "legacy",
    description:
      "A legacy retained row without the M047 trust marker fails open to cached coarse fallback guidance.",
    authorAssociation: "NONE",
    contributorProfile: {
      overallTier: "established",
      trustMarker: null,
    },
    authorCache: {
      tier: "regular",
      prCount: 4,
    },
    expectations: {
      trustState: "legacy",
      trustReason: "missing-trust-marker",
      calibrationMarker: null,
      calibrationVersion: null,
      contractState: "coarse-fallback",
      contractSource: "author-cache",
      fallbackPath: "stored-profile-legacy->author-cache",
      degradationPath: null,
      requiredPromptPhrases: [
        "Contributor-experience contract: coarse-fallback.",
        "only coarse fallback signals",
      ],
      bannedPromptPhrases: [
        "The PR author (octocat) is an established contributor.",
        "Contributor-experience contract: profile-backed.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        ...SHARED_REVIEW_DETAILS_BANNED_PHRASES,
      ],
    },
  },
  stale: {
    scenarioId: "stale",
    description:
      "A stale calibrated row fails open to generic degraded guidance when fallback search stays rate-limited.",
    authorAssociation: "NONE",
    contributorProfile: {
      overallTier: "established",
      lastScoredAt: new Date("2025-09-01T00:00:00.000Z"),
    },
    searchError: createSearchRateLimitError(),
    expectations: {
      trustState: "stale",
      trustReason: "trust-marker-stale",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
      contractState: "generic-degraded",
      contractSource: "github-search",
      fallbackPath: "stored-profile-stale->generic-degraded",
      degradationPath: "search-api-rate-limit",
      requiredPromptPhrases: [
        "Contributor-experience contract: generic-degraded.",
        "Fallback contributor signals are unavailable for the PR author (octocat) (search-api-rate-limit).",
        "## Search API Degradation Context",
        SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
      ],
      bannedPromptPhrases: [
        "The PR author (octocat) is an established contributor.",
        "Contributor-experience contract: profile-backed.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: generic-degraded (fallback signals unavailable: search-api-rate-limit)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        ...SHARED_REVIEW_DETAILS_BANNED_PHRASES,
      ],
    },
  },
  calibrated: {
    scenarioId: "calibrated",
    description:
      "A retained calibrated stored profile stays profile-backed even when contradictory coarse cache data exists.",
    authorAssociation: "NONE",
    contributorProfile: {
      overallTier: "established",
    },
    authorCache: {
      tier: "regular",
      prCount: 4,
    },
    expectations: {
      trustState: "calibrated",
      trustReason: "current-trust-marker",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
      contractState: "profile-backed",
      contractSource: "contributor-profile",
      fallbackPath: "trusted-stored-profile",
      degradationPath: null,
      requiredPromptPhrases: [
        "Contributor-experience contract: profile-backed.",
        "The PR author (octocat) is an established contributor.",
        "Keep explanations brief",
      ],
      bannedPromptPhrases: [
        "Contributor-experience contract: coarse-fallback.",
        "Contributor-experience contract: generic-opt-out.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: profile-backed (using linked contributor profile guidance)",
      ],
      bannedReviewDetailsPhrases: [
        "coarse-fallback",
        "generic-opt-out",
        ...SHARED_REVIEW_DETAILS_BANNED_PHRASES,
      ],
    },
  },
  "opt-out": {
    scenarioId: "opt-out",
    description:
      "An opted-out contributor stays generic even when the stored row is otherwise calibrated and cache data exists.",
    authorAssociation: "NONE",
    contributorProfile: {
      overallTier: "established",
      optedOut: true,
    },
    authorCache: {
      tier: "core",
      prCount: 12,
    },
    expectations: {
      trustState: "calibrated",
      trustReason: "current-trust-marker",
      calibrationMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      calibrationVersion: "v1",
      contractState: "generic-opt-out",
      contractSource: "contributor-profile",
      fallbackPath: "opted-out-stored-profile",
      degradationPath: null,
      requiredPromptPhrases: [
        "Contributor-experience contract: generic-opt-out.",
        "Contributor-specific guidance is disabled by opt-out for the PR author (octocat).",
      ],
      bannedPromptPhrases: [
        "The PR author (octocat) is an established contributor.",
        "Contributor-experience contract: profile-backed.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: generic-opt-out (contributor-specific guidance disabled by opt-out)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        "coarse-fallback",
        ...SHARED_REVIEW_DETAILS_BANNED_PHRASES,
      ],
    },
  },
  "coarse-fallback-cache": {
    scenarioId: "coarse-fallback-cache",
    description:
      "A cache-only fallback stays coarse and does not overclaim senior or profile-backed certainty.",
    authorAssociation: "NONE",
    authorCache: {
      tier: "core",
      prCount: 25,
    },
    expectations: {
      trustState: null,
      trustReason: null,
      calibrationMarker: null,
      calibrationVersion: null,
      contractState: "coarse-fallback",
      contractSource: "author-cache",
      fallbackPath: "no-stored-profile->author-cache",
      degradationPath: null,
      requiredPromptPhrases: [
        "Contributor-experience contract: coarse-fallback.",
        "only coarse fallback signals",
      ],
      bannedPromptPhrases: [
        "core/senior contributor of this repository.",
        "The author has deep expertise in",
        "Contributor-experience contract: profile-backed.",
      ],
      requiredReviewDetailsPhrases: [
        "- Contributor experience: coarse-fallback (using coarse fallback signals only)",
      ],
      bannedReviewDetailsPhrases: [
        "profile-backed",
        ...SHARED_REVIEW_DETAILS_BANNED_PHRASES,
      ],
    },
  },
};

export const M047_S01_CHECK_IDS = M047_S01_SCENARIO_IDS.map((scenarioId) =>
  toCheckId(scenarioId)
) as readonly string[];

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

function createSearchRateLimitError(): unknown {
  return {
    status: 429,
    message: "secondary rate limit",
    response: {
      headers: {
        "retry-after": "0",
      },
      data: {
        message: "You have exceeded a secondary rate limit",
      },
    },
  };
}

function makeProfile(
  overrides: Partial<ContributorProfile> & { overallTier?: string } = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: null,
    displayName: "Octo Cat",
    overallTier: "established",
    overallScore: 0.82,
    optedOut: false,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
    trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
    ...overrides,
  } as ContributorProfile;
}

function createContributorProfileStore(
  profile: (Partial<ContributorProfile> & { overallTier?: string }) | null | undefined,
): ContributorProfileStore | undefined {
  if (!profile) {
    return undefined;
  }

  const storedProfile = makeProfile(profile);

  return {
    getByGithubUsername: async () => storedProfile,
    getBySlackUserId: async () => null,
    linkIdentity: async () => {
      throw new Error("not implemented in proof harness");
    },
    unlinkSlack: async () => undefined,
    setOptedOut: async () => undefined,
    getExpertise: async () => [],
    upsertExpertise: async () => undefined,
    updateTier: async () => undefined,
    getOrCreateByGithubUsername: async () => storedProfile,
    getAllScores: async () => [],
  };
}

function createKnowledgeStore(definition: ScenarioDefinition) {
  if (!definition.authorCache) {
    return undefined;
  }

  return {
    getAuthorCache: async () => ({
      tier: definition.authorCache!.tier,
      authorAssociation: definition.authorAssociation,
      prCount: definition.authorCache!.prCount,
      cachedAt: "2026-04-10T00:00:00.000Z",
    }),
    upsertAuthorCache: async () => undefined,
  };
}

function getScenarioDefinition(
  scenarioId: M047S01ScenarioId,
): ScenarioDefinition {
  return SCENARIO_DEFINITIONS[scenarioId];
}

function toCheckId(scenarioId: M047S01ScenarioId): string {
  return `M047-S01-${scenarioId.toUpperCase()}-RUNTIME-TRUTHFUL`;
}

function createStatusCodePrefix(scenarioId: M047S01ScenarioId): string {
  return scenarioId.replace(/-/g, "_");
}

function buildResolverSearchOperation(definition: ScenarioDefinition) {
  return async () => {
    if (definition.searchError) {
      throw definition.searchError;
    }
    return {
      data: {
        total_count: definition.searchPrCount ?? 4,
      },
    };
  };
}

function basePromptContext(
  classification: ReviewAuthorClassification,
): Parameters<typeof buildReviewPrompt>[0] {
  return {
    owner: "acme",
    repo: "repo",
    prNumber: 4701,
    prTitle: "Verify stored-profile runtime contributor resolution",
    prBody:
      "Exercise the trust-aware review author resolution seam and keep prompt/Review Details output truthful.",
    prAuthor: "octocat",
    baseBranch: "main",
    headBranch: "kodiai/verify-m047-s01",
    changedFiles: ["src/handlers/review.ts"],
    mode: "standard",
    severityMinLevel: "medium",
    focusAreas: [],
    ignoredAreas: ["style"],
    maxComments: 7,
    suppressions: [],
    minConfidence: 0,
    contributorExperienceContract: classification.contract,
    searchRateLimitDegradation: classification.searchEnrichment.degraded
      ? {
        degraded: classification.searchEnrichment.degraded,
        retryAttempts: classification.searchEnrichment.retryAttempts,
        skippedQueries: classification.searchEnrichment.skippedQueries,
        degradationPath: classification.searchEnrichment.degradationPath,
      }
      : null,
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
  scenarioId: M047S01ScenarioId;
  problems: string[];
  promptDrift?: SurfaceDrift;
  reviewDetailsDrift?: SurfaceDrift;
}): string {
  const detailParts = [`scenario=${params.scenarioId}`];

  if (params.problems.length > 0) {
    detailParts.push(...params.problems);
  }

  if (params.promptDrift) {
    if (params.promptDrift.missingPhrases.length > 0) {
      detailParts.push(
        `missing required prompt phrases: ${params.promptDrift.missingPhrases.join(", ")}`,
      );
    }
    if (params.promptDrift.unexpectedPhrases.length > 0) {
      detailParts.push(
        `unexpected prompt phrases present: ${params.promptDrift.unexpectedPhrases.join(", ")}`,
      );
    }
  }

  if (params.reviewDetailsDrift) {
    if (params.reviewDetailsDrift.missingPhrases.length > 0) {
      detailParts.push(
        `missing required review-details phrases: ${params.reviewDetailsDrift.missingPhrases.join(", ")}`,
      );
    }
    if (params.reviewDetailsDrift.unexpectedPhrases.length > 0) {
      detailParts.push(
        `unexpected review-details phrases present: ${params.reviewDetailsDrift.unexpectedPhrases.join(", ")}`,
      );
    }
  }

  return detailParts.join("; ");
}

function buildExecutionErrorCheck(
  scenarioId: M047S01ScenarioId,
  err: unknown,
): Check {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    id: toCheckId(scenarioId),
    scenarioId,
    passed: false,
    skipped: false,
    status_code: "runtime_scenario_execution_failed",
    detail: `scenario=${scenarioId}; ${detail}`,
  };
}

function buildExecutionErrorScenario(
  scenarioId: M047S01ScenarioId,
  check: Check,
): ScenarioReport {
  const definition = getScenarioDefinition(scenarioId);
  return {
    scenarioId,
    description: definition.description,
    trustState: null,
    trustReason: null,
    calibrationMarker: null,
    calibrationVersion: null,
    contractState: null,
    contractSource: null,
    fallbackPath: null,
    degradationPath: null,
    promptSurfaceText: "",
    reviewDetailsBody: "",
    check: {
      checkId: check.id,
      passed: check.passed,
      statusCode: check.status_code,
      detail: check.detail,
    },
  };
}

function evaluateScenarioFixture(fixture: ScenarioFixture): Check {
  const definition = getScenarioDefinition(fixture.scenarioId);
  const { expectations } = definition;
  const promptDrift = collectSurfaceDrift(
    fixture.promptSurfaceText,
    expectations.requiredPromptPhrases,
    expectations.bannedPromptPhrases,
  );
  const reviewDetailsDrift = collectSurfaceDrift(
    fixture.reviewDetailsBody,
    expectations.requiredReviewDetailsPhrases,
    expectations.bannedReviewDetailsPhrases,
  );
  const problems: string[] = [];

  if (expectations.trustState === null) {
    if (fixture.trustState !== null) {
      problems.push(`trustState=${fixture.trustState} expected null`);
    }
  } else if (fixture.trustState === null) {
    problems.push("trustState missing");
  } else if (fixture.trustState !== expectations.trustState) {
    problems.push(`trustState=${fixture.trustState} expected ${expectations.trustState}`);
  }

  if (expectations.trustReason === null) {
    if (fixture.trustReason !== null) {
      problems.push(`trustReason=${fixture.trustReason} expected null`);
    }
  } else if (fixture.trustReason === null) {
    problems.push("trustReason missing");
  } else if (fixture.trustReason !== expectations.trustReason) {
    problems.push(`trustReason=${fixture.trustReason} expected ${expectations.trustReason}`);
  }

  if (fixture.calibrationMarker !== expectations.calibrationMarker) {
    problems.push(
      `calibrationMarker=${fixture.calibrationMarker ?? "null"} expected ${expectations.calibrationMarker ?? "null"}`,
    );
  }

  if (fixture.calibrationVersion !== expectations.calibrationVersion) {
    problems.push(
      `calibrationVersion=${fixture.calibrationVersion ?? "null"} expected ${expectations.calibrationVersion ?? "null"}`,
    );
  }

  if (fixture.contractState === null) {
    problems.push("contractState missing");
  } else if (fixture.contractState !== expectations.contractState) {
    problems.push(`contractState=${fixture.contractState} expected ${expectations.contractState}`);
  }

  if (fixture.contractSource === null) {
    problems.push("contractSource missing");
  } else if (fixture.contractSource !== expectations.contractSource) {
    problems.push(`contractSource=${fixture.contractSource} expected ${expectations.contractSource}`);
  }

  if (fixture.fallbackPath === null) {
    problems.push("fallbackPath missing");
  } else if (fixture.fallbackPath !== expectations.fallbackPath) {
    problems.push(`fallbackPath=${fixture.fallbackPath} expected ${expectations.fallbackPath}`);
  }

  if (fixture.degradationPath !== expectations.degradationPath) {
    problems.push(
      `degradationPath=${fixture.degradationPath ?? "null"} expected ${expectations.degradationPath ?? "null"}`,
    );
  }

  if (!fixture.promptSurfaceText.trim()) {
    problems.push("promptSurfaceText missing");
  }

  if (!fixture.reviewDetailsBody.trim()) {
    problems.push("reviewDetailsBody missing");
  }

  const passed =
    problems.length === 0
    && promptDrift.missingPhrases.length === 0
    && promptDrift.unexpectedPhrases.length === 0
    && reviewDetailsDrift.missingPhrases.length === 0
    && reviewDetailsDrift.unexpectedPhrases.length === 0;

  return {
    id: toCheckId(fixture.scenarioId),
    scenarioId: fixture.scenarioId,
    passed,
    skipped: false,
    status_code: passed
      ? `${createStatusCodePrefix(fixture.scenarioId)}_runtime_truthful`
      : "runtime_surface_truthfulness_failed",
    detail: buildDetail({
      scenarioId: fixture.scenarioId,
      problems,
      promptDrift,
      reviewDetailsDrift,
    }),
  };
}

export async function buildM047S01ScenarioFixture(params: {
  scenarioId: M047S01ScenarioId;
}): Promise<ScenarioFixture> {
  const definition = getScenarioDefinition(params.scenarioId);
  const contributorProfileStore = createContributorProfileStore(
    definition.contributorProfile,
  );
  const classification = await resolveReviewAuthorClassification({
    authorLogin: "octocat",
    authorAssociation: definition.authorAssociation,
    repo: "repo",
    owner: "acme",
    repoSlug: "acme/repo",
    searchIssuesAndPullRequests: buildResolverSearchOperation(definition),
    knowledgeStore: createKnowledgeStore(definition),
    contributorProfileStore,
    logger: createNoopLogger(),
    referenceTime: REFERENCE_TIME,
  });

  const prompt = buildReviewPrompt(basePromptContext(classification));
  const promptAuthorSection = extractPromptSection(prompt, "Author Experience Context");
  const promptDegradationSection = extractPromptSection(
    prompt,
    "Search API Degradation Context",
  );
  const promptSurfaceText = [promptAuthorSection, promptDegradationSection]
    .filter(Boolean)
    .join("\n\n") || prompt;

  const reviewDetailsBody = formatReviewDetailsSummary({
    reviewOutputKey: `m047-s01-${params.scenarioId}`,
    filesReviewed: 1,
    linesAdded: 8,
    linesRemoved: 2,
    findingCounts: { critical: 0, major: 1, medium: 0, minor: 0 },
    profileSelection: BASE_PROFILE_SELECTION,
    contributorExperience: classification.contract.reviewDetails,
  });

  return {
    scenarioId: params.scenarioId,
    description: definition.description,
    trustState: classification.storedProfileTrust?.state ?? null,
    trustReason: classification.storedProfileTrust?.reason ?? null,
    calibrationMarker: classification.storedProfileTrust?.calibrationMarker ?? null,
    calibrationVersion: classification.storedProfileTrust?.calibrationVersion ?? null,
    contractState: classification.contract.state,
    contractSource: classification.contract.source,
    fallbackPath: classification.fallbackPath,
    degradationPath: classification.contract.degradationPath,
    promptSurfaceText,
    reviewDetailsBody,
  };
}

export async function runScenarioTruthfulCheck(
  scenarioId: M047S01ScenarioId,
  runFixture?: (
    scenarioId: M047S01ScenarioId,
  ) => MaybePromise<ScenarioFixture>,
): Promise<Check> {
  try {
    const fixture = runFixture
      ? await runFixture(scenarioId)
      : await buildM047S01ScenarioFixture({ scenarioId });
    return evaluateScenarioFixture(fixture);
  } catch (err) {
    return buildExecutionErrorCheck(scenarioId, err);
  }
}

export async function evaluateM047S01(opts?: {
  runFixture?: (
    scenarioId: M047S01ScenarioId,
  ) => MaybePromise<ScenarioFixture>;
  generatedAt?: string;
}): Promise<EvaluationReport> {
  const generatedAt = opts?.generatedAt ?? new Date().toISOString();
  const scenarios: ScenarioReport[] = [];
  const checks: Check[] = [];

  for (const scenarioId of M047_S01_SCENARIO_IDS) {
    try {
      const fixture = opts?.runFixture
        ? await opts.runFixture(scenarioId)
        : await buildM047S01ScenarioFixture({ scenarioId });
      const check = evaluateScenarioFixture(fixture);
      checks.push(check);
      scenarios.push({
        ...fixture,
        check: {
          checkId: check.id,
          passed: check.passed,
          statusCode: check.status_code,
          detail: check.detail,
        },
      });
    } catch (err) {
      const check = buildExecutionErrorCheck(scenarioId, err);
      checks.push(check);
      scenarios.push(buildExecutionErrorScenario(scenarioId, check));
    }
  }

  return {
    command: "verify:m047:s01",
    generatedAt,
    check_ids: M047_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    scenarios,
    checks,
  };
}

export function renderM047S01Report(report: EvaluationReport): string {
  const lines = [
    "M047 S01 proof harness: stored-profile runtime contributor resolution",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Scenarios:",
  ];

  for (const scenario of report.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} ${scenario.check.passed ? "PASS" : "FAIL"} trust=${scenario.trustState ?? "none"} reason=${scenario.trustReason ?? "none"} contract=${scenario.contractState ?? "missing"} source=${scenario.contractSource ?? "missing"} fallback=${scenario.fallbackPath ?? "missing"} degradation=${scenario.degradationPath ?? "none"} status_code=${scenario.check.statusCode}`,
    );

    if (scenario.check.detail && !scenario.check.passed) {
      lines.push(`  detail: ${scenario.check.detail}`);
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

export async function buildM047S01ProofHarness(opts?: {
  runFixture?: (
    scenarioId: M047S01ScenarioId,
  ) => MaybePromise<ScenarioFixture>;
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM047S01({
    runFixture: opts?.runFixture,
  });

  if (opts?.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM047S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m047:s01 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM047S01ProofHarness({ json: useJson });
  process.exit(exitCode);
}
