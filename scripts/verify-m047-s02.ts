import type { Logger } from "pino";
import {
  projectContributorExperienceContract,
  resolveContributorExperienceRetrievalHint,
  type ContributorExperienceSource,
} from "../src/contributor/experience-contract.ts";
import { CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER } from "../src/contributor/profile-trust.ts";
import { resolveReviewAuthorClassification } from "../src/contributor/review-author-resolution.ts";
import type {
  ContributorExpertise,
  ContributorProfile,
  ContributorProfileStore,
} from "../src/contributor/types.ts";
import { resetIdentitySuggestionStateForTests, suggestIdentityLink } from "../src/handlers/identity-suggest.ts";
import type { AuthorTier } from "../src/lib/author-classifier.ts";
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
  handleKodiaiCommand,
  type SlashCommandResult,
} from "../src/slack/slash-command-handler.ts";
import {
  buildM047S01ScenarioFixture,
  evaluateM047S01,
  type EvaluationReport as M047S01EvaluationReport,
  type M047S01ScenarioId,
} from "./verify-m047-s01.ts";

const REFERENCE_TIME = new Date("2026-04-10T12:00:00.000Z");
const FIXTURE_TIME = new Date("2026-04-10T00:00:00.000Z");
const BASE_RETRIEVAL_TITLE = "Verify stored-profile downstream truth alignment";
const BASE_RETRIEVAL_BODY =
  "Keep Slack/profile continuity, retrieval hints, and identity suppression aligned with stored-profile contract states.";
const BASE_RETRIEVAL_TYPE = "test";
const BASE_RETRIEVAL_LANGUAGES = ["TypeScript"];
const BASE_RETRIEVAL_RISK_SIGNALS = ["stored-profile-contract"];
const BASE_RETRIEVAL_FILE_PATHS = [
  "src/contributor/profile-surface-resolution.ts",
  "src/slack/slash-command-handler.ts",
  "src/knowledge/multi-query-retrieval.ts",
  "src/knowledge/retrieval-query.ts",
];

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

export const M047_S02_SCENARIO_IDS = [
  "linked-unscored",
  "legacy",
  "stale",
  "calibrated",
  "malformed",
  "opt-out",
] as const;

export const M047_S02_CHECK_IDS = [
  "M047-S02-S01-REPORT-COMPOSED",
  "M047-S02-SLACK-PROFILE-CONTRACT",
  "M047-S02-CONTINUITY-CONTRACT",
  "M047-S02-RETRIEVAL-MULTI-QUERY-CONTRACT",
  "M047-S02-RETRIEVAL-LEGACY-QUERY-CONTRACT",
  "M047-S02-IDENTITY-SUPPRESSION-CONTRACT",
] as const;

export type ScenarioId = (typeof M047_S02_SCENARIO_IDS)[number];
export type M047S02CheckId = (typeof M047_S02_CHECK_IDS)[number];

type RuntimeSnapshot = {
  trustState: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
};

type TextSurfaceExpectations = {
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
};

type RetrievalPhraseExpectations = {
  requiredMultiQueryPhrases: readonly string[];
  bannedMultiQueryPhrases: readonly string[];
  requiredLegacyPhrases: readonly string[];
  bannedLegacyPhrases: readonly string[];
};

type IdentityExpectations = {
  expectedFetchUrls: readonly string[];
  expectedDm: boolean;
  expectedWarningLogged: boolean;
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
};

type StoredProfileSeed = Omit<ContributorProfile, "overallTier"> & {
  overallTier: string;
  expertise: ContributorExpertise[];
};

export type ScenarioFixture = {
  scenarioId: ScenarioId;
  description: string;
  runtimeSource: "m047-s01" | "local";
  runtimeExpectation: RuntimeSnapshot;
  retrievalContractInput: {
    source: ContributorExperienceSource;
    tier?: AuthorTier | null;
    optedOut?: boolean;
    degraded?: boolean;
    degradationPath?: string | null;
  };
  profileSeed: StoredProfileSeed;
  profile: TextSurfaceExpectations;
  linkContinuity: TextSurfaceExpectations | null;
  optInContinuity: TextSurfaceExpectations;
  retrieval: RetrievalPhraseExpectations;
  identitySuppression?: IdentityExpectations | null;
};

type SurfaceDrift = {
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type TextSurfaceReport = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  text: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type RetrievalSurfaceReport = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  query: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type IdentitySurfaceReport = {
  passed: boolean;
  statusCode: string;
  detail?: string;
  fetchUrls: string[];
  dmText: string | null;
  warningLogged: boolean;
  warningMessages: string[];
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type ScenarioReport = {
  scenarioId: ScenarioId;
  description: string;
  trustState: string | null;
  contractState: string | null;
  contractSource: string | null;
  fallbackPath: string | null;
  degradationPath: string | null;
  profile: TextSurfaceReport;
  linkContinuity: TextSurfaceReport | null;
  optInContinuity: TextSurfaceReport;
  retrievalMultiQuery: RetrievalSurfaceReport;
  retrievalLegacyQuery: RetrievalSurfaceReport;
  identitySuppression: IdentitySurfaceReport | null;
};

export type Check = {
  id: M047S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: "verify:m047:s02";
  generatedAt: string;
  check_ids: readonly string[];
  overallPassed: boolean;
  storedProfileRuntime: M047S01EvaluationReport | null;
  scenarios: ScenarioReport[];
  checks: Check[];
};

function createSilentLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createSilentLogger(),
    level: "silent",
  } as unknown as Logger;
}

function extractLoggerMessage(args: unknown[]): string {
  const message = args.findLast((arg) => typeof arg === "string");
  return typeof message === "string" ? message : "";
}

function createIdentityLogger(): {
  logger: Logger;
  warningMessages: string[];
} {
  const warningMessages: string[] = [];
  const logger = {
    info: () => undefined,
    warn: (...args: unknown[]) => {
      const message = extractLoggerMessage(args);
      if (message) {
        warningMessages.push(message);
      }
    },
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
    level: "silent",
  } as unknown as Logger;

  return { logger, warningMessages };
}

function buildExpertiseSeed(params: {
  id: number;
  profileId: number;
  dimension: ContributorExpertise["dimension"];
  topic: string;
  score: number;
  rawSignals: number;
}): ContributorExpertise {
  return {
    id: params.id,
    profileId: params.profileId,
    dimension: params.dimension,
    topic: params.topic,
    score: params.score,
    rawSignals: params.rawSignals,
    lastActive: new Date(FIXTURE_TIME),
    createdAt: new Date(FIXTURE_TIME),
    updatedAt: new Date(FIXTURE_TIME),
  };
}

function buildStoredProfileSeed(params: {
  id: number;
  githubUsername: string;
  slackUserId: string | null;
  displayName: string | null;
  overallTier: string;
  overallScore: number;
  optedOut: boolean;
  lastScoredAt: Date | null;
  trustMarker?: string | null;
  expertise?: ContributorExpertise[];
}): StoredProfileSeed {
  return {
    id: params.id,
    githubUsername: params.githubUsername,
    slackUserId: params.slackUserId,
    displayName: params.displayName,
    overallTier: params.overallTier,
    overallScore: params.overallScore,
    optedOut: params.optedOut,
    createdAt: new Date(FIXTURE_TIME),
    updatedAt: new Date(FIXTURE_TIME),
    lastScoredAt: params.lastScoredAt ? new Date(params.lastScoredAt) : null,
    trustMarker: params.trustMarker ?? null,
    expertise: params.expertise ? params.expertise.map(cloneExpertise) : [],
  };
}

function cloneExpertise(entry: ContributorExpertise): ContributorExpertise {
  return {
    ...entry,
    lastActive: entry.lastActive ? new Date(entry.lastActive) : null,
    createdAt: new Date(entry.createdAt),
    updatedAt: new Date(entry.updatedAt),
  };
}

function cloneStoredProfileSeed(seed: StoredProfileSeed): StoredProfileSeed {
  return {
    ...seed,
    slackUserId: seed.slackUserId,
    displayName: seed.displayName,
    createdAt: new Date(seed.createdAt),
    updatedAt: new Date(seed.updatedAt),
    lastScoredAt: seed.lastScoredAt ? new Date(seed.lastScoredAt) : null,
    expertise: seed.expertise.map(cloneExpertise),
  };
}

function toContributorProfile(seed: StoredProfileSeed): ContributorProfile {
  return {
    id: seed.id,
    githubUsername: seed.githubUsername,
    slackUserId: seed.slackUserId,
    displayName: seed.displayName,
    overallTier: seed.overallTier as ContributorProfile["overallTier"],
    overallScore: seed.overallScore,
    optedOut: seed.optedOut,
    createdAt: new Date(seed.createdAt),
    updatedAt: new Date(seed.updatedAt),
    lastScoredAt: seed.lastScoredAt ? new Date(seed.lastScoredAt) : null,
    trustMarker: seed.trustMarker ?? null,
  };
}

function createInMemoryContributorProfileStore(params: {
  profiles?: StoredProfileSeed[];
}): {
  store: ContributorProfileStore;
  setOptedOutCalls: Array<{ githubUsername: string; optedOut: boolean }>;
} {
  const records = new Map<string, StoredProfileSeed>();
  for (const seed of params.profiles ?? []) {
    records.set(seed.githubUsername, cloneStoredProfileSeed(seed));
  }

  const setOptedOutCalls: Array<{ githubUsername: string; optedOut: boolean }> = [];

  function findBySlackUserId(slackUserId: string): StoredProfileSeed | null {
    for (const record of records.values()) {
      if (record.slackUserId === slackUserId) {
        return record;
      }
    }
    return null;
  }

  const store: ContributorProfileStore = {
    async getByGithubUsername(username, options = {}) {
      const record = records.get(username);
      if (!record) {
        return null;
      }
      if (record.optedOut && !options.includeOptedOut) {
        return null;
      }
      return toContributorProfile(record);
    },
    async getBySlackUserId(slackUserId) {
      const record = findBySlackUserId(slackUserId);
      return record ? toContributorProfile(record) : null;
    },
    async linkIdentity(linkParams) {
      const existing = records.get(linkParams.githubUsername);
      const record: StoredProfileSeed = existing
        ? {
            ...existing,
            slackUserId: linkParams.slackUserId,
            displayName: linkParams.displayName,
            optedOut: false,
            updatedAt: new Date(FIXTURE_TIME),
          }
        : buildStoredProfileSeed({
            id: records.size + 1,
            githubUsername: linkParams.githubUsername,
            slackUserId: linkParams.slackUserId,
            displayName: linkParams.displayName,
            overallTier: "newcomer",
            overallScore: 0,
            optedOut: false,
            lastScoredAt: null,
            trustMarker: null,
            expertise: [],
          });
      records.set(record.githubUsername, record);
      return toContributorProfile(record);
    },
    async unlinkSlack(githubUsername) {
      const record = records.get(githubUsername);
      if (record) {
        record.slackUserId = null;
        record.updatedAt = new Date(FIXTURE_TIME);
      }
    },
    async setOptedOut(githubUsername, optedOut) {
      const record = records.get(githubUsername);
      if (!record) {
        throw new Error(`missing profile for ${githubUsername}`);
      }
      record.optedOut = optedOut;
      record.updatedAt = new Date(FIXTURE_TIME);
      setOptedOutCalls.push({ githubUsername, optedOut });
    },
    async getExpertise(profileId) {
      const record = [...records.values()].find((entry) => entry.id === profileId);
      return record ? record.expertise.map(cloneExpertise) : [];
    },
    async upsertExpertise(update) {
      const record = [...records.values()].find((entry) => entry.id === update.profileId);
      if (!record) {
        return;
      }
      const existingIndex = record.expertise.findIndex(
        (entry) => entry.dimension === update.dimension && entry.topic === update.topic,
      );
      const next = buildExpertiseSeed({
        id: existingIndex >= 0 ? record.expertise[existingIndex]!.id : record.expertise.length + 1,
        profileId: update.profileId,
        dimension: update.dimension,
        topic: update.topic,
        score: update.score,
        rawSignals: update.rawSignals,
      });
      next.lastActive = new Date(update.lastActive);
      if (existingIndex >= 0) {
        record.expertise.splice(existingIndex, 1, next);
      } else {
        record.expertise.push(next);
      }
    },
    async updateTier(profileId, tier, overallScore) {
      const record = [...records.values()].find((entry) => entry.id === profileId);
      if (!record) {
        return;
      }
      record.overallTier = tier;
      record.overallScore = overallScore;
      record.lastScoredAt = new Date(FIXTURE_TIME);
      record.trustMarker = CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER;
      record.updatedAt = new Date(FIXTURE_TIME);
    },
    async getOrCreateByGithubUsername(username) {
      const existing = records.get(username);
      if (existing) {
        return toContributorProfile(existing);
      }
      const created = buildStoredProfileSeed({
        id: records.size + 1,
        githubUsername: username,
        slackUserId: null,
        displayName: null,
        overallTier: "newcomer",
        overallScore: 0,
        optedOut: false,
        lastScoredAt: null,
        trustMarker: null,
        expertise: [],
      });
      records.set(username, created);
      return toContributorProfile(created);
    },
    async getAllScores() {
      return [...records.values()]
        .filter((record) => !record.optedOut)
        .map((record) => ({
          profileId: record.id,
          overallScore: record.overallScore,
        }));
    },
  };

  return { store, setOptedOutCalls };
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

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toStatusPrefix(scenarioId: ScenarioId): string {
  return scenarioId.replace(/-/g, "_");
}

function buildRetrievalExpectations(expectedHint: string | null): RetrievalPhraseExpectations {
  if (expectedHint) {
    const otherHints = APPROVED_RETRIEVAL_HINTS.filter((hint) => hint !== expectedHint);
    return {
      requiredMultiQueryPhrases: [`author: ${expectedHint}`],
      bannedMultiQueryPhrases: otherHints.map((hint) => `author: ${hint}`),
      requiredLegacyPhrases: [`Author: ${expectedHint}`],
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

function buildTextDetail(params: {
  scenarioId: ScenarioId;
  surface: string;
  drift: SurfaceDrift;
  problems: string[];
}): string {
  const parts = [`scenario=${params.scenarioId}`, `surface=${params.surface}`];

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

function buildRetrievalDetail(params: {
  scenarioId: ScenarioId;
  surface: string;
  drift: SurfaceDrift;
  problems: string[];
}): string {
  return buildTextDetail(params);
}

function buildIdentityDetail(params: {
  scenarioId: ScenarioId;
  drift: SurfaceDrift;
  problems: string[];
  fetchUrls: string[];
  warningLogged: boolean;
}): string {
  const parts = [
    `scenario=${params.scenarioId}`,
    "surface=identity-suppression",
    `fetches=${params.fetchUrls.join(",") || "none"}`,
    `warningLogged=${params.warningLogged}`,
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

function validateEmbeddedS01Report(report: unknown): {
  report: M047S01EvaluationReport | null;
  problems: string[];
} {
  if (!report || typeof report !== "object") {
    return {
      report: null,
      problems: ["embedded S01 report was missing or non-object"],
    };
  }

  const candidate = report as Partial<M047S01EvaluationReport>;
  const problems: string[] = [];

  if (candidate.command !== "verify:m047:s01") {
    problems.push(`embedded command=${String(candidate.command)} expected verify:m047:s01`);
  }
  if (!Array.isArray(candidate.check_ids) || candidate.check_ids.length === 0) {
    problems.push("embedded check_ids were missing");
  }
  if (!Array.isArray(candidate.checks) || candidate.checks.length === 0) {
    problems.push("embedded checks were missing");
  }
  if (!Array.isArray(candidate.scenarios) || candidate.scenarios.length === 0) {
    problems.push("embedded scenario data was missing");
  }

  return {
    report: problems.length === 0 ? (candidate as M047S01EvaluationReport) : null,
    problems,
  };
}

function validateRuntimeSnapshot(
  actual: RuntimeSnapshot,
  expected: RuntimeSnapshot,
): string[] {
  const problems: string[] = [];

  if (actual.trustState !== expected.trustState) {
    problems.push(`trustState=${actual.trustState ?? "null"} expected ${expected.trustState ?? "null"}`);
  }
  if (actual.contractState !== expected.contractState) {
    problems.push(`contractState=${actual.contractState ?? "null"} expected ${expected.contractState ?? "null"}`);
  }
  if (actual.contractSource !== expected.contractSource) {
    problems.push(`contractSource=${actual.contractSource ?? "null"} expected ${expected.contractSource ?? "null"}`);
  }
  if (actual.fallbackPath !== expected.fallbackPath) {
    problems.push(`fallbackPath=${actual.fallbackPath ?? "null"} expected ${expected.fallbackPath ?? "null"}`);
  }
  if (actual.degradationPath !== expected.degradationPath) {
    problems.push(`degradationPath=${actual.degradationPath ?? "null"} expected ${expected.degradationPath ?? "null"}`);
  }

  return problems;
}

function buildRuntimeSnapshotFromS01Fixture(fixture: Awaited<ReturnType<typeof buildM047S01ScenarioFixture>>): RuntimeSnapshot {
  return {
    trustState: fixture.trustState,
    contractState: fixture.contractState,
    contractSource: fixture.contractSource,
    fallbackPath: fixture.fallbackPath,
    degradationPath: fixture.degradationPath,
  };
}

async function buildMalformedRuntimeSnapshot(profileSeed: StoredProfileSeed): Promise<RuntimeSnapshot> {
  const { store } = createInMemoryContributorProfileStore({
    profiles: [profileSeed],
  });
  const classification = await resolveReviewAuthorClassification({
    authorLogin: profileSeed.githubUsername,
    authorAssociation: "NONE",
    repo: "repo",
    owner: "acme",
    repoSlug: "acme/repo",
    searchIssuesAndPullRequests: async () => ({ data: { total_count: 4 } }),
    contributorProfileStore: store,
    logger: createSilentLogger(),
    referenceTime: REFERENCE_TIME,
  });

  return {
    trustState: classification.storedProfileTrust?.state ?? null,
    contractState: classification.contract.state,
    contractSource: classification.contract.source,
    fallbackPath: classification.fallbackPath,
    degradationPath: classification.contract.degradationPath,
  };
}

async function buildRuntimeSnapshotForScenario(fixture: ScenarioFixture): Promise<RuntimeSnapshot> {
  if (fixture.runtimeSource === "local") {
    return buildMalformedRuntimeSnapshot(fixture.profileSeed);
  }

  const upstreamFixture = await buildM047S01ScenarioFixture({
    scenarioId: fixture.scenarioId as M047S01ScenarioId,
  });
  return buildRuntimeSnapshotFromS01Fixture(upstreamFixture);
}

function createBaseExpertise(profileId: number): ContributorExpertise[] {
  return [
    buildExpertiseSeed({
      id: 1,
      profileId,
      dimension: "language",
      topic: "typescript",
      score: 0.9,
      rawSignals: 50,
    }),
  ];
}

export function buildM047S02ScenarioFixtures(): ScenarioFixture[] {
  const calibratedExpertise = createBaseExpertise(4);
  const optOutExpertise = createBaseExpertise(6).map((entry) => ({
    ...cloneExpertise(entry),
    id: 2,
    profileId: 6,
  }));

  return [
    {
      scenarioId: "linked-unscored",
      description:
        "A linked but never-scored stored row stays generic on Slack/profile surfaces while retrieval falls back to coarse returning-contributor hints.",
      runtimeSource: "m047-s01",
      runtimeExpectation: {
        trustState: "linked-unscored",
        contractState: "coarse-fallback",
        contractSource: "github-search",
        fallbackPath: "stored-profile-linked-unscored->github-search",
        degradationPath: null,
      },
      retrievalContractInput: {
        source: "github-search",
        tier: "regular",
      },
      profileSeed: buildStoredProfileSeed({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Octo Cat",
        overallTier: "newcomer",
        overallScore: 0,
        optedOut: false,
        lastScoredAt: null,
        trustMarker: null,
        expertise: [],
      }),
      profile: {
        requiredPhrases: [
          "*Contributor Profile*",
          "GitHub: `octocat`",
          "Status: Generic contributor guidance is active.",
          "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
        ],
        bannedPhrases: ["*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
      },
      linkContinuity: {
        requiredPhrases: [
          "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
        ],
        bannedPhrases: ["Linked contributor guidance is active for your profile."],
      },
      optInContinuity: {
        requiredPhrases: [
          "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
        bannedPhrases: [
          "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
      },
      retrieval: buildRetrievalExpectations("returning contributor"),
      identitySuppression: null,
    },
    {
      scenarioId: "legacy",
      description:
        "A legacy retained row stays generic on Slack/profile surfaces while retrieval reuses only coarse author-cache hints.",
      runtimeSource: "m047-s01",
      runtimeExpectation: {
        trustState: "legacy",
        contractState: "coarse-fallback",
        contractSource: "author-cache",
        fallbackPath: "stored-profile-legacy->author-cache",
        degradationPath: null,
      },
      retrievalContractInput: {
        source: "author-cache",
        tier: "regular",
      },
      profileSeed: buildStoredProfileSeed({
        id: 2,
        githubUsername: "octocat",
        slackUserId: "U002",
        displayName: "Octo Cat",
        overallTier: "established",
        overallScore: 0.75,
        optedOut: false,
        lastScoredAt: new Date("2026-04-01T00:00:00.000Z"),
        trustMarker: null,
        expertise: [],
      }),
      profile: {
        requiredPhrases: [
          "*Contributor Profile*",
          "GitHub: `octocat`",
          "Status: Generic contributor guidance is active.",
          "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
        ],
        bannedPhrases: ["*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
      },
      linkContinuity: {
        requiredPhrases: [
          "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
        ],
        bannedPhrases: ["Linked contributor guidance is active for your profile."],
      },
      optInContinuity: {
        requiredPhrases: [
          "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
        bannedPhrases: [
          "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
      },
      retrieval: buildRetrievalExpectations("returning contributor"),
      identitySuppression: null,
    },
    {
      scenarioId: "stale",
      description:
        "A stale calibrated row stays generic on Slack/profile surfaces and suppresses retrieval hints when fallback search is degraded.",
      runtimeSource: "m047-s01",
      runtimeExpectation: {
        trustState: "stale",
        contractState: "generic-degraded",
        contractSource: "github-search",
        fallbackPath: "stored-profile-stale->generic-degraded",
        degradationPath: "search-api-rate-limit",
      },
      retrievalContractInput: {
        source: "github-search",
        tier: "regular",
        degraded: true,
        degradationPath: "search-api-rate-limit",
      },
      profileSeed: buildStoredProfileSeed({
        id: 3,
        githubUsername: "octocat",
        slackUserId: "U003",
        displayName: "Octo Cat",
        overallTier: "established",
        overallScore: 0.82,
        optedOut: false,
        lastScoredAt: new Date("2025-09-01T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        expertise: [],
      }),
      profile: {
        requiredPhrases: [
          "*Contributor Profile*",
          "GitHub: `octocat`",
          "Status: Generic contributor guidance is active.",
          "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
        ],
        bannedPhrases: ["*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
      },
      linkContinuity: {
        requiredPhrases: [
          "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
        ],
        bannedPhrases: ["Linked contributor guidance is active for your profile."],
      },
      optInContinuity: {
        requiredPhrases: [
          "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
        bannedPhrases: [
          "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
      },
      retrieval: buildRetrievalExpectations(null),
      identitySuppression: null,
    },
    {
      scenarioId: "calibrated",
      description:
        "A calibrated stored row stays profile-backed across Slack/profile, continuity, and retrieval surfaces.",
      runtimeSource: "m047-s01",
      runtimeExpectation: {
        trustState: "calibrated",
        contractState: "profile-backed",
        contractSource: "contributor-profile",
        fallbackPath: "trusted-stored-profile",
        degradationPath: null,
      },
      retrievalContractInput: {
        source: "contributor-profile",
        tier: "established",
      },
      profileSeed: buildStoredProfileSeed({
        id: 4,
        githubUsername: "octocat",
        slackUserId: "U004",
        displayName: "Octo Cat",
        overallTier: "established",
        overallScore: 0.82,
        optedOut: false,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        expertise: calibratedExpertise,
      }),
      profile: {
        requiredPhrases: [
          "*Contributor Profile*",
          "GitHub: `octocat`",
          "Status: Linked contributor guidance is active.",
          "Kodiai can adapt review guidance using your linked contributor profile.",
          "*Top Expertise:*",
          "language/typescript: 0.90",
        ],
        bannedPhrases: ["Tier:", "Score:", ...RAW_TIER_VOCABULARY],
      },
      linkContinuity: {
        requiredPhrases: [
          "Linked your Slack account to GitHub user `octocat`. Linked contributor guidance is active for your profile. Use `/kodiai profile` to review your status.",
        ],
        bannedPhrases: ["Kodiai will keep your reviews generic until your linked profile has current contributor signals."],
      },
      optInContinuity: {
        requiredPhrases: [
          "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
        bannedPhrases: [
          "Kodiai will keep reviews generic until current contributor signals are available.",
        ],
      },
      retrieval: buildRetrievalExpectations("established contributor"),
      identitySuppression: null,
    },
    {
      scenarioId: "malformed",
      description:
        "A malformed stored tier stays generic on Slack/profile surfaces while retrieval reuses only coarse fallback hints.",
      runtimeSource: "local",
      runtimeExpectation: {
        trustState: "malformed",
        contractState: "coarse-fallback",
        contractSource: "github-search",
        fallbackPath: "stored-profile-malformed->github-search",
        degradationPath: null,
      },
      retrievalContractInput: {
        source: "github-search",
        tier: "regular",
      },
      profileSeed: buildStoredProfileSeed({
        id: 5,
        githubUsername: "octocat",
        slackUserId: "U005",
        displayName: "Octo Cat",
        overallTier: "mystery-tier",
        overallScore: 0.2,
        optedOut: false,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        expertise: [],
      }),
      profile: {
        requiredPhrases: [
          "*Contributor Profile*",
          "GitHub: `octocat`",
          "Status: Generic contributor guidance is active.",
          "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
        ],
        bannedPhrases: ["mystery-tier", "*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
      },
      linkContinuity: {
        requiredPhrases: [
          "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
        ],
        bannedPhrases: ["Linked contributor guidance is active for your profile."],
      },
      optInContinuity: {
        requiredPhrases: [
          "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
        bannedPhrases: [
          "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
      },
      retrieval: buildRetrievalExpectations("returning contributor"),
      identitySuppression: null,
    },
    {
      scenarioId: "opt-out",
      description:
        "An opted-out calibrated row stays generic on Slack/profile output, re-enables active continuity on opt-in, suppresses retrieval hints, and skips identity suggestions.",
      runtimeSource: "m047-s01",
      runtimeExpectation: {
        trustState: "calibrated",
        contractState: "generic-opt-out",
        contractSource: "contributor-profile",
        fallbackPath: "opted-out-stored-profile",
        degradationPath: null,
      },
      retrievalContractInput: {
        source: "contributor-profile",
        tier: "established",
        optedOut: true,
      },
      profileSeed: buildStoredProfileSeed({
        id: 6,
        githubUsername: "octocat",
        slackUserId: "U006",
        displayName: "Octo Cat",
        overallTier: "established",
        overallScore: 0.82,
        optedOut: true,
        lastScoredAt: new Date("2026-04-09T00:00:00.000Z"),
        trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        expertise: optOutExpertise,
      }),
      profile: {
        requiredPhrases: [
          "*Contributor Profile*",
          "GitHub: `octocat`",
          "Status: Generic contributor guidance is active.",
          "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
        ],
        bannedPhrases: ["*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
      },
      linkContinuity: null,
      optInContinuity: {
        requiredPhrases: [
          "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
        ],
        bannedPhrases: [
          "Kodiai will keep reviews generic until current contributor signals are available.",
        ],
      },
      retrieval: buildRetrievalExpectations(null),
      identitySuppression: {
        expectedFetchUrls: [],
        expectedDm: false,
        expectedWarningLogged: false,
        requiredPhrases: [],
        bannedPhrases: ["linked contributor profile"],
      },
    },
  ];
}

function buildRetrievalInputs(fixture: ScenarioFixture): {
  multiQueryInput: BuildRetrievalVariantsInput;
  legacySignals: RetrievalQuerySignals;
} {
  const contract = projectContributorExperienceContract({
    source: fixture.retrievalContractInput.source,
    tier: fixture.retrievalContractInput.tier ?? null,
    optedOut: fixture.retrievalContractInput.optedOut,
    degraded: fixture.retrievalContractInput.degraded,
    degradationPath: fixture.retrievalContractInput.degradationPath,
  });
  const authorHint = resolveContributorExperienceRetrievalHint(contract);

  return {
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
  };
}

async function runTextCommand(params: {
  commandText: string;
  slackUserId: string;
  slackUserName: string;
  store: ContributorProfileStore;
}): Promise<SlashCommandResult> {
  return handleKodiaiCommand({
    text: params.commandText,
    slackUserId: params.slackUserId,
    slackUserName: params.slackUserName,
    profileStore: params.store,
    logger: createSilentLogger(),
  });
}

function buildTextSurfaceReport(params: {
  scenarioId: ScenarioId;
  surface: string;
  text: string;
  drift: SurfaceDrift;
  problems: string[];
}): TextSurfaceReport {
  const passed =
    params.problems.length === 0 &&
    params.drift.missingPhrases.length === 0 &&
    params.drift.unexpectedPhrases.length === 0;

  return {
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.scenarioId)}_${params.surface}_truthful`
      : `${params.surface}_truthfulness_failed`,
    detail: buildTextDetail({
      scenarioId: params.scenarioId,
      surface: params.surface,
      drift: params.drift,
      problems: params.problems,
    }),
    text: params.text,
    missingPhrases: params.drift.missingPhrases,
    unexpectedPhrases: params.drift.unexpectedPhrases,
  };
}

async function evaluateProfileSurface(
  fixture: ScenarioFixture,
  runtimeProblems: string[],
): Promise<TextSurfaceReport> {
  const { store } = createInMemoryContributorProfileStore({
    profiles: [fixture.profileSeed],
  });
  const problems = [...runtimeProblems];
  let result: SlashCommandResult | null = null;

  try {
    result = await runTextCommand({
      commandText: "profile",
      slackUserId: fixture.profileSeed.slackUserId ?? "U-PROFILE",
      slackUserName: fixture.profileSeed.displayName ?? "Octo Cat",
      store,
    });
  } catch (error) {
    problems.push(`command threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = result?.text ?? "";
  const drift = collectSurfaceDrift(text, fixture.profile.requiredPhrases, fixture.profile.bannedPhrases);

  if (!result) {
    problems.push("slash command handler returned no response");
  } else if (result.responseType !== "ephemeral") {
    problems.push(`responseType=${result.responseType} expected=ephemeral`);
  }

  return buildTextSurfaceReport({
    scenarioId: fixture.scenarioId,
    surface: "profile_surface",
    text,
    drift,
    problems,
  });
}

async function evaluateLinkContinuity(
  fixture: ScenarioFixture,
  runtimeProblems: string[],
): Promise<TextSurfaceReport | null> {
  if (!fixture.linkContinuity) {
    return null;
  }

  const linkSeed = cloneStoredProfileSeed({
    ...fixture.profileSeed,
    slackUserId: null,
    displayName: null,
    optedOut: false,
  });
  const { store } = createInMemoryContributorProfileStore({
    profiles: [linkSeed],
  });
  const problems = [...runtimeProblems];
  let result: SlashCommandResult | null = null;

  try {
    result = await runTextCommand({
      commandText: `link ${fixture.profileSeed.githubUsername}`,
      slackUserId: fixture.profileSeed.slackUserId ?? "U-LINK",
      slackUserName: fixture.profileSeed.displayName ?? "Octo Cat",
      store,
    });
  } catch (error) {
    problems.push(`command threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = result?.text ?? "";
  const drift = collectSurfaceDrift(
    text,
    fixture.linkContinuity.requiredPhrases,
    fixture.linkContinuity.bannedPhrases,
  );

  if (!result) {
    problems.push("slash command handler returned no response");
  } else if (result.responseType !== "ephemeral") {
    problems.push(`responseType=${result.responseType} expected=ephemeral`);
  }

  return buildTextSurfaceReport({
    scenarioId: fixture.scenarioId,
    surface: "link_continuity",
    text,
    drift,
    problems,
  });
}

async function evaluateOptInContinuity(
  fixture: ScenarioFixture,
  runtimeProblems: string[],
): Promise<TextSurfaceReport> {
  const optInSeed = cloneStoredProfileSeed({
    ...fixture.profileSeed,
    optedOut: true,
  });
  const { store, setOptedOutCalls } = createInMemoryContributorProfileStore({
    profiles: [optInSeed],
  });
  const problems = [...runtimeProblems];
  let result: SlashCommandResult | null = null;

  try {
    result = await runTextCommand({
      commandText: "profile opt-in",
      slackUserId: optInSeed.slackUserId ?? "U-OPT-IN",
      slackUserName: optInSeed.displayName ?? "Octo Cat",
      store,
    });
  } catch (error) {
    problems.push(`command threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = result?.text ?? "";
  const drift = collectSurfaceDrift(
    text,
    fixture.optInContinuity.requiredPhrases,
    fixture.optInContinuity.bannedPhrases,
  );

  if (!result) {
    problems.push("slash command handler returned no response");
  } else if (result.responseType !== "ephemeral") {
    problems.push(`responseType=${result.responseType} expected=ephemeral`);
  }

  const [call] = setOptedOutCalls;
  if (!call) {
    problems.push("expected setOptedOut to be called");
  } else if (call.optedOut !== false) {
    problems.push(`setOptedOut=${call.optedOut} expected=false`);
  }

  return buildTextSurfaceReport({
    scenarioId: fixture.scenarioId,
    surface: "opt_in_continuity",
    text,
    drift,
    problems,
  });
}

function buildRetrievalSurfaceReport(params: {
  scenarioId: ScenarioId;
  surface: "retrieval_multi_query" | "retrieval_legacy_query";
  query: string;
  drift: SurfaceDrift;
  problems: string[];
}): RetrievalSurfaceReport {
  const passed =
    params.problems.length === 0 &&
    params.drift.missingPhrases.length === 0 &&
    params.drift.unexpectedPhrases.length === 0;

  return {
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.scenarioId)}_${params.surface}_truthful`
      : `${params.surface}_truthfulness_failed`,
    detail: buildRetrievalDetail({
      scenarioId: params.scenarioId,
      surface: params.surface,
      drift: params.drift,
      problems: params.problems,
    }),
    query: params.query,
    missingPhrases: params.drift.missingPhrases,
    unexpectedPhrases: params.drift.unexpectedPhrases,
  };
}

function evaluateRetrievalSurfaces(
  fixture: ScenarioFixture,
  runtimeProblems: string[],
): {
  multiQuery: RetrievalSurfaceReport;
  legacyQuery: RetrievalSurfaceReport;
} {
  const { multiQueryInput, legacySignals } = buildRetrievalInputs(fixture);
  const multiQueryProblems = [...runtimeProblems];
  const legacyProblems = [...runtimeProblems];

  const variants = buildRetrievalVariants(multiQueryInput);
  const intentVariant = variants.find((variant) => variant.type === "intent");
  const multiQuery = intentVariant?.query ?? "";
  if (!intentVariant) {
    multiQueryProblems.push("intent variant was not rendered");
  }
  if (!multiQuery.trim()) {
    multiQueryProblems.push("query text was empty");
  }
  const multiQueryDrift = collectSurfaceDrift(
    multiQuery,
    fixture.retrieval.requiredMultiQueryPhrases,
    fixture.retrieval.bannedMultiQueryPhrases,
  );

  const legacyQuery = buildRetrievalQuery(legacySignals);
  if (!legacyQuery.trim()) {
    legacyProblems.push("query text was empty");
  }
  const legacyQueryDrift = collectSurfaceDrift(
    legacyQuery,
    fixture.retrieval.requiredLegacyPhrases,
    fixture.retrieval.bannedLegacyPhrases,
  );

  return {
    multiQuery: buildRetrievalSurfaceReport({
      scenarioId: fixture.scenarioId,
      surface: "retrieval_multi_query",
      query: multiQuery,
      drift: multiQueryDrift,
      problems: multiQueryProblems,
    }),
    legacyQuery: buildRetrievalSurfaceReport({
      scenarioId: fixture.scenarioId,
      surface: "retrieval_legacy_query",
      query: legacyQuery,
      drift: legacyQueryDrift,
      problems: legacyProblems,
    }),
  };
}

async function evaluateIdentitySuppression(
  fixture: ScenarioFixture,
  runtimeProblems: string[],
): Promise<IdentitySurfaceReport | null> {
  if (!fixture.identitySuppression) {
    return null;
  }

  const originalFetch = globalThis.fetch;
  const fetchUrls: string[] = [];
  let dmText: string | null = null;
  const problems = [...runtimeProblems];
  const { logger, warningMessages } = createIdentityLogger();
  const { store } = createInMemoryContributorProfileStore({
    profiles: [fixture.profileSeed],
  });

  resetIdentitySuggestionStateForTests();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchUrls.push(url);

    if (url === "https://slack.com/api/chat.postMessage" && typeof init?.body === "string") {
      const payload = JSON.parse(init.body) as { text?: string };
      dmText = payload.text ?? null;
    }

    return new Response("unexpected fetch", { status: 500 });
  }) as unknown as typeof globalThis.fetch;

  try {
    await suggestIdentityLink({
      githubUsername: fixture.profileSeed.githubUsername,
      githubDisplayName: fixture.profileSeed.displayName,
      slackBotToken: "xoxb-test-token",
      profileStore: store,
      logger,
    });
  } catch (error) {
    problems.push(`identity suggester threw: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    globalThis.fetch = originalFetch;
    resetIdentitySuggestionStateForTests();
  }

  const warningLogged = warningMessages.length > 0;
  const surfaceText = dmText ?? warningMessages.join(" | ");
  const drift = collectSurfaceDrift(
    surfaceText,
    fixture.identitySuppression.requiredPhrases,
    fixture.identitySuppression.bannedPhrases,
  );

  if (!arrayEquals(fetchUrls, fixture.identitySuppression.expectedFetchUrls)) {
    problems.push(
      `fetchUrls=${fetchUrls.join(",") || "none"} expected=${fixture.identitySuppression.expectedFetchUrls.join(",") || "none"}`,
    );
  }
  if (fixture.identitySuppression.expectedDm && !dmText) {
    problems.push("expected DM text but none was sent");
  }
  if (!fixture.identitySuppression.expectedDm && dmText) {
    problems.push("unexpected DM text was sent");
  }
  if (warningLogged !== fixture.identitySuppression.expectedWarningLogged) {
    problems.push(
      `warningLogged=${warningLogged} expected=${fixture.identitySuppression.expectedWarningLogged}`,
    );
  }

  const passed =
    problems.length === 0 &&
    drift.missingPhrases.length === 0 &&
    drift.unexpectedPhrases.length === 0;

  return {
    passed,
    statusCode: passed
      ? `${toStatusPrefix(fixture.scenarioId)}_identity_suppression_truthful`
      : "identity_suppression_truthfulness_failed",
    detail: buildIdentityDetail({
      scenarioId: fixture.scenarioId,
      drift,
      problems,
      fetchUrls,
      warningLogged,
    }),
    fetchUrls,
    dmText,
    warningLogged,
    warningMessages,
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

async function evaluateScenario(fixture: ScenarioFixture): Promise<ScenarioReport> {
  const runtimeActual = await buildRuntimeSnapshotForScenario(fixture);
  const runtimeProblems = validateRuntimeSnapshot(runtimeActual, fixture.runtimeExpectation);

  const profile = await evaluateProfileSurface(fixture, runtimeProblems);
  const linkContinuity = await evaluateLinkContinuity(fixture, runtimeProblems);
  const optInContinuity = await evaluateOptInContinuity(fixture, runtimeProblems);
  const retrieval = evaluateRetrievalSurfaces(fixture, runtimeProblems);
  const identitySuppression = await evaluateIdentitySuppression(fixture, runtimeProblems);

  return {
    scenarioId: fixture.scenarioId,
    description: fixture.description,
    trustState: runtimeActual.trustState,
    contractState: runtimeActual.contractState,
    contractSource: runtimeActual.contractSource,
    fallbackPath: runtimeActual.fallbackPath,
    degradationPath: runtimeActual.degradationPath,
    profile,
    linkContinuity,
    optInContinuity,
    retrievalMultiQuery: retrieval.multiQuery,
    retrievalLegacyQuery: retrieval.legacyQuery,
    identitySuppression,
  };
}

function buildEmbeddedRuntimeCheck(params: {
  report: M047S01EvaluationReport | null;
  problems: string[];
}): Check {
  if (params.problems.length > 0 || !params.report) {
    return {
      id: "M047-S02-S01-REPORT-COMPOSED",
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
      id: "M047-S02-S01-REPORT-COMPOSED",
      passed: false,
      skipped: false,
      status_code: "embedded_s01_report_failed",
      detail: `embedded S01 report failed: ${failingNestedChecks.join(", ")}`,
    };
  }

  return {
    id: "M047-S02-S01-REPORT-COMPOSED",
    passed: true,
    skipped: false,
    status_code: "embedded_s01_report_preserved",
    detail: `embedded ${params.report.checks.length} S01 checks across ${params.report.scenarios.length} scenarios`,
  };
}

function buildSurfaceCheck(params: {
  id: Extract<
    M047S02CheckId,
    | "M047-S02-SLACK-PROFILE-CONTRACT"
    | "M047-S02-CONTINUITY-CONTRACT"
    | "M047-S02-RETRIEVAL-MULTI-QUERY-CONTRACT"
    | "M047-S02-RETRIEVAL-LEGACY-QUERY-CONTRACT"
    | "M047-S02-IDENTITY-SUPPRESSION-CONTRACT"
  >;
  passStatusCode: string;
  failStatusCode: string;
  failingEntries: string[];
}): Check {
  if (params.failingEntries.length === 0) {
    return {
      id: params.id,
      passed: true,
      skipped: false,
      status_code: params.passStatusCode,
    };
  }

  return {
    id: params.id,
    passed: false,
    skipped: false,
    status_code: params.failStatusCode,
    detail: params.failingEntries.join("; "),
  };
}

export async function evaluateM047S02(opts?: {
  generatedAt?: string;
  _evaluateS01?: () => Promise<unknown>;
  _scenarioFixtures?: ScenarioFixture[];
}): Promise<EvaluationReport> {
  let embeddedUnknown: unknown;
  let embeddedProblems: string[] = [];
  try {
    embeddedUnknown = opts?._evaluateS01 ? await opts._evaluateS01() : await evaluateM047S01();
  } catch (error) {
    embeddedProblems = [
      `embedded S01 evaluation threw: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const validatedEmbedded = embeddedProblems.length > 0
    ? { report: null, problems: embeddedProblems }
    : validateEmbeddedS01Report(embeddedUnknown);

  const fixtures = opts?._scenarioFixtures ?? buildM047S02ScenarioFixtures();
  const scenarios: ScenarioReport[] = [];
  for (const fixture of fixtures) {
    scenarios.push(await evaluateScenario(fixture));
  }

  const profileFailures = scenarios
    .filter((scenario) => !scenario.profile.passed)
    .map((scenario) => `${scenario.scenarioId}:${scenario.profile.statusCode}`);

  const continuityFailures = scenarios.flatMap((scenario) => {
    const failures: string[] = [];
    if (scenario.linkContinuity && !scenario.linkContinuity.passed) {
      failures.push(`${scenario.scenarioId}:link:${scenario.linkContinuity.statusCode}`);
    }
    if (!scenario.optInContinuity.passed) {
      failures.push(`${scenario.scenarioId}:opt-in:${scenario.optInContinuity.statusCode}`);
    }
    return failures;
  });

  const multiQueryFailures = scenarios
    .filter((scenario) => !scenario.retrievalMultiQuery.passed)
    .map((scenario) => `${scenario.scenarioId}:${scenario.retrievalMultiQuery.statusCode}`);

  const legacyQueryFailures = scenarios
    .filter((scenario) => !scenario.retrievalLegacyQuery.passed)
    .map((scenario) => `${scenario.scenarioId}:${scenario.retrievalLegacyQuery.statusCode}`);

  const identityFailures = scenarios
    .filter((scenario) => scenario.identitySuppression && !scenario.identitySuppression.passed)
    .map((scenario) => `${scenario.scenarioId}:${scenario.identitySuppression!.statusCode}`);

  const checks: Check[] = [
    buildEmbeddedRuntimeCheck(validatedEmbedded),
    buildSurfaceCheck({
      id: "M047-S02-SLACK-PROFILE-CONTRACT",
      passStatusCode: "slack_profile_contract_truthful",
      failStatusCode: "slack_profile_contract_drift",
      failingEntries: profileFailures,
    }),
    buildSurfaceCheck({
      id: "M047-S02-CONTINUITY-CONTRACT",
      passStatusCode: "continuity_contract_truthful",
      failStatusCode: "continuity_contract_drift",
      failingEntries: continuityFailures,
    }),
    buildSurfaceCheck({
      id: "M047-S02-RETRIEVAL-MULTI-QUERY-CONTRACT",
      passStatusCode: "retrieval_multi_query_contract_truthful",
      failStatusCode: "retrieval_multi_query_contract_drift",
      failingEntries: multiQueryFailures,
    }),
    buildSurfaceCheck({
      id: "M047-S02-RETRIEVAL-LEGACY-QUERY-CONTRACT",
      passStatusCode: "retrieval_legacy_query_contract_truthful",
      failStatusCode: "retrieval_legacy_query_contract_drift",
      failingEntries: legacyQueryFailures,
    }),
    buildSurfaceCheck({
      id: "M047-S02-IDENTITY-SUPPRESSION-CONTRACT",
      passStatusCode: "identity_suppression_contract_truthful",
      failStatusCode: "identity_suppression_contract_drift",
      failingEntries: identityFailures,
    }),
  ];

  return {
    command: "verify:m047:s02",
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    check_ids: M047_S02_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    storedProfileRuntime: validatedEmbedded.report,
    scenarios,
    checks,
  };
}

export function renderM047S02Report(report: EvaluationReport): string {
  const lines = [
    "M047 S02 proof harness: stored-profile downstream truth",
    `Generated at: ${report.generatedAt}`,
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Embedded S01 runtime truth:",
  ];

  if (!report.storedProfileRuntime) {
    lines.push("- missing embedded S01 report");
  } else {
    lines.push(
      `- embedded verdict: ${report.storedProfileRuntime.overallPassed ? "PASS" : "FAIL"} scenarios=${report.storedProfileRuntime.scenarios.length} checks=${report.storedProfileRuntime.checks.length}`,
    );
  }

  lines.push("Stored-profile scenarios:");
  for (const scenario of report.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} trust=${scenario.trustState ?? "none"} contract=${scenario.contractState ?? "missing"} source=${scenario.contractSource ?? "missing"} fallback=${scenario.fallbackPath ?? "missing"} degradation=${scenario.degradationPath ?? "none"} profile=${scenario.profile.passed ? "pass" : "fail"} link=${scenario.linkContinuity ? (scenario.linkContinuity.passed ? "pass" : "fail") : "skip"} opt-in=${scenario.optInContinuity.passed ? "pass" : "fail"} retrieval-multi-query=${scenario.retrievalMultiQuery.passed ? "pass" : "fail"} retrieval-legacy-query=${scenario.retrievalLegacyQuery.passed ? "pass" : "fail"} identity=${scenario.identitySuppression ? (scenario.identitySuppression.passed ? "pass" : "fail") : "skip"}`,
    );

    if (!scenario.profile.passed && scenario.profile.detail) {
      lines.push(`  profile: ${scenario.profile.detail}`);
    }
    if (scenario.linkContinuity && !scenario.linkContinuity.passed && scenario.linkContinuity.detail) {
      lines.push(`  link: ${scenario.linkContinuity.detail}`);
    }
    if (!scenario.optInContinuity.passed && scenario.optInContinuity.detail) {
      lines.push(`  opt-in: ${scenario.optInContinuity.detail}`);
    }
    if (!scenario.retrievalMultiQuery.passed && scenario.retrievalMultiQuery.detail) {
      lines.push(`  retrieval-multi-query: ${scenario.retrievalMultiQuery.detail}`);
    }
    if (!scenario.retrievalLegacyQuery.passed && scenario.retrievalLegacyQuery.detail) {
      lines.push(`  retrieval-legacy-query: ${scenario.retrievalLegacyQuery.detail}`);
    }
    if (scenario.identitySuppression && !scenario.identitySuppression.passed && scenario.identitySuppression.detail) {
      lines.push(`  identity: ${scenario.identitySuppression.detail}`);
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

export async function buildM047S02ProofHarness(opts?: {
  stdout?: { write: (chunk: string) => boolean | void };
  stderr?: { write: (chunk: string) => boolean | void };
  json?: boolean;
  _evaluateS01?: () => Promise<unknown>;
  _scenarioFixtures?: ScenarioFixture[];
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM047S02({
    _evaluateS01: opts?._evaluateS01,
    _scenarioFixtures: opts?._scenarioFixtures,
  });

  if (opts?.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM047S02Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m047:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM047S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
