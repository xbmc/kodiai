import type { Logger } from "pino";
import {
  projectContributorExperienceContract,
  resolveContributorExperienceRetrievalHint,
  type ContributorExperienceContract,
  type ContributorExperienceContractState,
} from "../src/contributor/experience-contract.ts";
import { CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER } from "../src/contributor/profile-trust.ts";
import type {
  ContributorExpertise,
  ContributorProfile,
  ContributorProfileStore,
} from "../src/contributor/types.ts";
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
  resetIdentitySuggestionStateForTests,
  suggestIdentityLink,
} from "../src/handlers/identity-suggest.ts";
import {
  handleKodiaiCommand,
  type SlashCommandResult,
} from "../src/slack/slash-command-handler.ts";
import {
  M045_S01_SCENARIO_IDS,
  evaluateM045S01,
  type EvaluationReport as M045S01EvaluationReport,
} from "./verify-m045-s01.ts";

export const M045_S03_CHECK_IDS = [
  "M045-S03-S01-REPORT-COMPOSED",
  "M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT",
  "M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT",
  "M045-S03-SLACK-SURFACES-CONTRACT",
  "M045-S03-IDENTITY-LINK-CONTRACT",
] as const;

export const M045_S03_SLACK_SCENARIO_IDS = [
  "linked-profile",
  "opted-out-profile",
  "malformed-tier-profile",
  "profile-opt-out",
  "profile-opt-in",
  "unknown-command-help",
] as const;

export const M045_S03_IDENTITY_SCENARIO_IDS = [
  "existing-linked-profile",
  "no-high-confidence-match",
  "high-confidence-match-dm",
  "slack-api-failure-warning",
] as const;

export type M045S03CheckId = (typeof M045_S03_CHECK_IDS)[number];
export type RetrievalScenarioId = (typeof M045_S01_SCENARIO_IDS)[number];
export type SlackScenarioId = (typeof M045_S03_SLACK_SCENARIO_IDS)[number];
export type IdentityScenarioId = (typeof M045_S03_IDENTITY_SCENARIO_IDS)[number];

type RetrievalSurfaceKind = "multi-query" | "legacy-query";

type RetrievalPhraseExpectations = {
  requiredMultiQueryPhrases: readonly string[];
  bannedMultiQueryPhrases: readonly string[];
  requiredLegacyPhrases: readonly string[];
  bannedLegacyPhrases: readonly string[];
};

type SurfaceDrift = {
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

type SlackProfileSeed = Omit<ContributorProfile, "overallTier"> & {
  overallTier: string;
  trustMarker?: string | null;
  expertise: ContributorExpertise[];
};

type IdentityFetchHandler = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CapturedFetchRequest = {
  url: string;
  body: string | null;
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

export type SlackScenarioReport = {
  scenarioId: SlackScenarioId;
  description: string;
  responseType: SlashCommandResult["responseType"] | null;
  text: string;
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type SlackFixture = {
  scenarioId: SlackScenarioId;
  description: string;
  commandText: string;
  slackUserId: string;
  slackUserName: string;
  profiles: SlackProfileSeed[];
  expectedResponseType: SlashCommandResult["responseType"];
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
  expectedSetOptedOut?: boolean;
};

export type IdentityScenarioReport = {
  scenarioId: IdentityScenarioId;
  description: string;
  dmText: string | null;
  warningLogged: boolean;
  warningMessages: string[];
  fetchUrls: string[];
  passed: boolean;
  statusCode: string;
  detail?: string;
  missingPhrases: string[];
  unexpectedPhrases: string[];
};

export type IdentityFixture = {
  scenarioId: IdentityScenarioId;
  description: string;
  githubUsername: string;
  githubDisplayName: string | null;
  existingProfile?: {
    githubUsername: string;
    slackUserId: string | null;
  } | null;
  fetchHandler: IdentityFetchHandler;
  expectedFetchUrls: readonly string[];
  expectedDm: boolean;
  expectedWarningLogged: boolean;
  requiredPhrases: readonly string[];
  bannedPhrases: readonly string[];
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
  slack: {
    scenarios: SlackScenarioReport[];
  };
  identity: {
    scenarios: IdentityScenarioReport[];
  };
  checks: Check[];
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
const FIXTURE_TIME = new Date("2026-04-10T00:00:00.000Z");

function toStatusPrefix(
  scenarioId: RetrievalScenarioId | SlackScenarioId | IdentityScenarioId,
): string {
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

function buildSlackDetail(params: {
  scenarioId: SlackScenarioId;
  commandText: string;
  responseType: SlashCommandResult["responseType"] | null;
  drift: SurfaceDrift;
  problems: string[];
}): string {
  const parts = [
    `scenario=${params.scenarioId}`,
    `command=${JSON.stringify(params.commandText)}`,
    `responseType=${params.responseType ?? "none"}`,
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

function buildIdentityDetail(params: {
  scenarioId: IdentityScenarioId;
  warningLogged: boolean;
  fetchUrls: string[];
  drift: SurfaceDrift;
  problems: string[];
}): string {
  const parts = [
    `scenario=${params.scenarioId}`,
    `warningLogged=${params.warningLogged}`,
    `fetches=${params.fetchUrls.join(",") || "none"}`,
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

function buildSlackProfileSeed(params: {
  id: number;
  githubUsername: string;
  slackUserId: string;
  displayName: string;
  overallTier: string;
  overallScore: number;
  optedOut: boolean;
  trustMarker?: string | null;
  expertise?: ContributorExpertise[];
}): SlackProfileSeed {
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
    lastScoredAt: new Date(FIXTURE_TIME),
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

function cloneSlackProfileSeed(seed: SlackProfileSeed): SlackProfileSeed {
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

function toContributorProfile(seed: SlackProfileSeed): ContributorProfile {
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
  profiles?: SlackProfileSeed[];
  githubProfile?: {
    githubUsername: string;
    slackUserId: string | null;
    optedOut?: boolean;
    trustMarker?: string | null;
  } | null;
}): {
  store: ContributorProfileStore;
  setOptedOutCalls: Array<{ githubUsername: string; optedOut: boolean }>;
} {
  const records = new Map<string, SlackProfileSeed>();
  for (const seed of params.profiles ?? []) {
    records.set(seed.githubUsername, cloneSlackProfileSeed(seed));
  }

  if (params.githubProfile) {
    const githubProfile = params.githubProfile;
    records.set(githubProfile.githubUsername, {
      id: 999,
      githubUsername: githubProfile.githubUsername,
      slackUserId: githubProfile.slackUserId,
      displayName: githubProfile.githubUsername,
      overallTier: "established",
      overallScore: 0.8,
      optedOut: githubProfile.optedOut ?? false,
      createdAt: new Date(FIXTURE_TIME),
      updatedAt: new Date(FIXTURE_TIME),
      lastScoredAt: new Date(FIXTURE_TIME),
      trustMarker:
        githubProfile.trustMarker ?? CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
      expertise: [],
    });
  }

  const setOptedOutCalls: Array<{ githubUsername: string; optedOut: boolean }> = [];

  function findBySlackUserId(slackUserId: string): SlackProfileSeed | null {
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
      const record: SlackProfileSeed = existing
        ? {
            ...existing,
            slackUserId: linkParams.slackUserId,
            displayName: linkParams.displayName,
            updatedAt: new Date(),
          }
        : {
            id: records.size + 1,
            githubUsername: linkParams.githubUsername,
            slackUserId: linkParams.slackUserId,
            displayName: linkParams.displayName,
            overallTier: "newcomer",
            overallScore: 0,
            optedOut: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastScoredAt: null,
            trustMarker: null,
            expertise: [],
          };
      records.set(record.githubUsername, record);
      return toContributorProfile(record);
    },
    async unlinkSlack(githubUsername) {
      const record = records.get(githubUsername);
      if (record) {
        record.slackUserId = null;
        record.updatedAt = new Date();
      }
    },
    async setOptedOut(githubUsername, optedOut) {
      const record = records.get(githubUsername);
      if (!record) {
        throw new Error(`missing profile for ${githubUsername}`);
      }
      record.optedOut = optedOut;
      record.updatedAt = new Date();
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
      record.lastScoredAt = new Date();
      record.updatedAt = new Date();
    },
    async getOrCreateByGithubUsername(username) {
      const existing = records.get(username);
      if (existing) {
        return toContributorProfile(existing);
      }
      const created: SlackProfileSeed = {
        id: records.size + 1,
        githubUsername: username,
        slackUserId: null,
        displayName: null,
        overallTier: "newcomer",
        overallScore: 0,
        optedOut: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: null,
        trustMarker: null,
        expertise: [],
      };
      records.set(username, created);
      return toContributorProfile(created);
    },
    async getAllScores() {
      return [...records.values()].map((record) => ({
        profileId: record.id,
        overallScore: record.overallScore,
      }));
    },
  };

  return { store, setOptedOutCalls };
}

function extractLoggerMessage(args: unknown[]): string {
  const message = args.find((arg) => typeof arg === "string");
  return typeof message === "string" ? message : "";
}

function createBufferingLogger(): {
  logger: Logger;
  warningMessages: string[];
} {
  const warningMessages: string[] = [];
  const logger = {
    info: () => undefined,
    warn: (...args: unknown[]) => {
      const message = extractLoggerMessage(args);
      warningMessages.push(message);
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

function normalizeFetchUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

export function buildM045S03SlackFixtures(): SlackFixture[] {
  const linkedExpertise = [
    buildExpertiseSeed({
      id: 1,
      profileId: 1,
      dimension: "language",
      topic: "typescript",
      score: 0.9,
      rawSignals: 50,
    }),
  ];

  return [
    {
      scenarioId: "linked-profile",
      description: "Linked `/kodiai profile` output stays contract-first and includes expertise.",
      commandText: "profile",
      slackUserId: "U001",
      slackUserName: "Octo",
      profiles: [
        buildSlackProfileSeed({
          id: 1,
          githubUsername: "octocat",
          slackUserId: "U001",
          displayName: "Octo",
          overallTier: "established",
          overallScore: 0.75,
          optedOut: false,
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
          expertise: linkedExpertise,
        }),
      ],
      expectedResponseType: "ephemeral",
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
    {
      scenarioId: "opted-out-profile",
      description: "Opted-out `/kodiai profile` output stays generic and hides expertise.",
      commandText: "profile",
      slackUserId: "U002",
      slackUserName: "Octo",
      profiles: [
        buildSlackProfileSeed({
          id: 2,
          githubUsername: "octocat",
          slackUserId: "U002",
          displayName: "Octo",
          overallTier: "senior",
          overallScore: 0.98,
          optedOut: true,
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
          expertise: linkedExpertise.map((entry) => ({
            ...cloneExpertise(entry),
            id: 2,
            profileId: 2,
          })),
        }),
      ],
      expectedResponseType: "ephemeral",
      requiredPhrases: [
        "*Contributor Profile*",
        "GitHub: `octocat`",
        "Status: Generic contributor guidance is active.",
        "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
      ],
      bannedPhrases: ["*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
    },
    {
      scenarioId: "malformed-tier-profile",
      description: "Malformed stored tier data falls back to neutral generic copy.",
      commandText: "profile",
      slackUserId: "U003",
      slackUserName: "Octo",
      profiles: [
        buildSlackProfileSeed({
          id: 3,
          githubUsername: "octocat",
          slackUserId: "U003",
          displayName: "Octo",
          overallTier: "mystery-tier",
          overallScore: 0.42,
          optedOut: false,
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
          expertise: [],
        }),
      ],
      expectedResponseType: "ephemeral",
      requiredPhrases: [
        "*Contributor Profile*",
        "GitHub: `octocat`",
        "Status: Generic contributor guidance is active.",
        "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
      ],
      bannedPhrases: ["mystery-tier", "*Top Expertise:*", "Tier:", "Score:", ...RAW_TIER_VOCABULARY],
    },
    {
      scenarioId: "profile-opt-out",
      description: "`/kodiai profile opt-out` advertises generic guidance and the opt-in recovery path.",
      commandText: "profile opt-out",
      slackUserId: "U004",
      slackUserName: "Octo",
      profiles: [
        buildSlackProfileSeed({
          id: 4,
          githubUsername: "octocat",
          slackUserId: "U004",
          displayName: "Octo",
          overallTier: "newcomer",
          overallScore: 0.1,
          optedOut: false,
          expertise: [],
        }),
      ],
      expectedResponseType: "ephemeral",
      expectedSetOptedOut: true,
      requiredPhrases: [
        "Contributor-specific guidance is now off.",
        "Kodiai will keep your reviews generic until you run `/kodiai profile opt-in`.",
        "Check `/kodiai profile` any time to review your current status.",
      ],
      bannedPhrases: ["personalized code reviews"],
    },
    {
      scenarioId: "profile-opt-in",
      description: "`/kodiai profile opt-in` advertises linked guidance and the opt-out path.",
      commandText: "profile opt-in",
      slackUserId: "U005",
      slackUserName: "Octo",
      profiles: [
        buildSlackProfileSeed({
          id: 5,
          githubUsername: "octocat",
          slackUserId: "U005",
          displayName: "Octo",
          overallTier: "newcomer",
          overallScore: 0.1,
          optedOut: true,
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
          expertise: [],
        }),
      ],
      expectedResponseType: "ephemeral",
      expectedSetOptedOut: false,
      requiredPhrases: [
        "Contributor-specific guidance is now on for your linked profile.",
        "Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
      ],
      bannedPhrases: ["personalized code reviews"],
    },
    {
      scenarioId: "unknown-command-help",
      description: "Unknown subcommands advertise both profile opt controls.",
      commandText: "foobar",
      slackUserId: "U006",
      slackUserName: "Octo",
      profiles: [],
      expectedResponseType: "ephemeral",
      requiredPhrases: [
        "Unknown command.",
        "`profile opt-in`",
        "`profile opt-out`",
      ],
      bannedPhrases: ["personalized code reviews"],
    },
  ];
}

export function buildM045S03IdentityFixtures(): IdentityFixture[] {
  return [
    {
      scenarioId: "existing-linked-profile",
      description: "Existing linked profiles skip Slack lookup entirely.",
      githubUsername: "linked-user",
      githubDisplayName: "Linked User",
      existingProfile: {
        githubUsername: "linked-user",
        slackUserId: "U-LINKED",
      },
      fetchHandler: async () => jsonResponse({ ok: true, members: [] }),
      expectedFetchUrls: [],
      expectedDm: false,
      expectedWarningLogged: false,
      requiredPhrases: [],
      bannedPhrases: [],
    },
    {
      scenarioId: "no-high-confidence-match",
      description: "Low-confidence matches stay non-blocking and do not open a DM.",
      githubUsername: "octocaat",
      githubDisplayName: null,
      fetchHandler: async (input) => {
        const url = normalizeFetchUrl(input);
        if (url === "https://slack.com/api/users.list") {
          return jsonResponse({
            ok: true,
            members: [
              {
                id: "U001",
                profile: { display_name: "octocat", real_name: "Octo Cat" },
              },
            ],
          });
        }
        return new Response("Not Found", { status: 404 });
      },
      expectedFetchUrls: ["https://slack.com/api/users.list"],
      expectedDm: false,
      expectedWarningLogged: false,
      requiredPhrases: [],
      bannedPhrases: [],
    },
    {
      scenarioId: "high-confidence-match-dm",
      description: "High-confidence matches send the truthful link + opt-out DM copy.",
      githubUsername: "octocat",
      githubDisplayName: "Octo Cat",
      fetchHandler: async (input) => {
        const url = normalizeFetchUrl(input);
        if (url === "https://slack.com/api/users.list") {
          return jsonResponse({
            ok: true,
            members: [
              {
                id: "U777",
                profile: { display_name: "octocat", real_name: "Octo Cat" },
              },
            ],
          });
        }
        if (url === "https://slack.com/api/conversations.open") {
          return jsonResponse({ ok: true, channel: { id: "D777" } });
        }
        if (url === "https://slack.com/api/chat.postMessage") {
          return jsonResponse({ ok: true });
        }
        return new Response("Not Found", { status: 404 });
      },
      expectedFetchUrls: [
        "https://slack.com/api/users.list",
        "https://slack.com/api/conversations.open",
        "https://slack.com/api/chat.postMessage",
      ],
      expectedDm: true,
      expectedWarningLogged: false,
      requiredPhrases: [
        "I noticed GitHub user `octocat` submitted a PR, and their profile may match your Slack account.",
        "`/kodiai link octocat`",
        "Kodiai can use your linked contributor profile when available.",
        "`/kodiai profile opt-out`",
      ],
      bannedPhrases: ["personalized code reviews"],
    },
    {
      scenarioId: "slack-api-failure-warning",
      description: "Slack API failures stay fail-open and visible through warning output.",
      githubUsername: "warning-user",
      githubDisplayName: "Warning User",
      fetchHandler: async (input) => {
        const url = normalizeFetchUrl(input);
        if (url === "https://slack.com/api/users.list") {
          return jsonResponse({
            ok: true,
            members: [
              {
                id: "U778",
                profile: {
                  display_name: "warning-user",
                  real_name: "Warning User",
                },
              },
            ],
          });
        }
        if (url === "https://slack.com/api/conversations.open") {
          return jsonResponse({ ok: false, error: "channel_not_found" });
        }
        if (url === "https://slack.com/api/chat.postMessage") {
          return jsonResponse({ ok: true });
        }
        return new Response("Not Found", { status: 404 });
      },
      expectedFetchUrls: [
        "https://slack.com/api/users.list",
        "https://slack.com/api/conversations.open",
      ],
      expectedDm: false,
      expectedWarningLogged: true,
      requiredPhrases: ["Identity suggestion check failed (non-blocking)"],
      bannedPhrases: ["personalized code reviews"],
    },
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

async function evaluateSlackScenario(params: {
  fixture: SlackFixture;
  _handleKodiaiCommand?: typeof handleKodiaiCommand;
}): Promise<SlackScenarioReport> {
  const { store, setOptedOutCalls } = createInMemoryContributorProfileStore({
    profiles: params.fixture.profiles,
  });
  const { logger } = createBufferingLogger();

  let response: SlashCommandResult | null = null;
  const problems: string[] = [];

  try {
    response = await (params._handleKodiaiCommand ?? handleKodiaiCommand)({
      text: params.fixture.commandText,
      slackUserId: params.fixture.slackUserId,
      slackUserName: params.fixture.slackUserName,
      profileStore: store,
      logger,
    });
  } catch (error) {
    problems.push(
      `command threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = response?.text ?? "";
  const responseType = response?.responseType ?? null;
  const drift = collectSurfaceDrift(
    text,
    params.fixture.requiredPhrases,
    params.fixture.bannedPhrases,
  );

  if (!response) {
    problems.push("slash command handler returned no response");
  }
  if (responseType !== params.fixture.expectedResponseType) {
    problems.push(
      `responseType=${responseType ?? "none"} expected=${params.fixture.expectedResponseType}`,
    );
  }
  if (typeof params.fixture.expectedSetOptedOut === "boolean") {
    const [call] = setOptedOutCalls;
    if (!call) {
      problems.push("expected setOptedOut to be called");
    } else if (call.optedOut !== params.fixture.expectedSetOptedOut) {
      problems.push(
        `setOptedOut=${call.optedOut} expected=${params.fixture.expectedSetOptedOut}`,
      );
    }
  }

  const passed =
    problems.length === 0 &&
    drift.missingPhrases.length === 0 &&
    drift.unexpectedPhrases.length === 0;

  return {
    scenarioId: params.fixture.scenarioId,
    description: params.fixture.description,
    responseType,
    text,
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.fixture.scenarioId)}_slack_surface_truthful`
      : "slack_surface_truthfulness_failed",
    detail: buildSlackDetail({
      scenarioId: params.fixture.scenarioId,
      commandText: params.fixture.commandText,
      responseType,
      drift,
      problems,
    }),
    missingPhrases: drift.missingPhrases,
    unexpectedPhrases: drift.unexpectedPhrases,
  };
}

async function evaluateIdentityScenario(params: {
  fixture: IdentityFixture;
  _suggestIdentityLink?: typeof suggestIdentityLink;
  _resetIdentitySuggestionState?: () => void;
}): Promise<IdentityScenarioReport> {
  const originalFetch = globalThis.fetch;
  const capturedRequests: CapturedFetchRequest[] = [];
  const { logger, warningMessages } = createBufferingLogger();
  const resetIdentityState =
    params._resetIdentitySuggestionState ?? resetIdentitySuggestionStateForTests;
  const { store } = createInMemoryContributorProfileStore({
    githubProfile: params.fixture.existingProfile ?? null,
  });
  const problems: string[] = [];

  resetIdentityState();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push({
      url: normalizeFetchUrl(input),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return params.fixture.fetchHandler(input, init);
  }) as typeof globalThis.fetch;

  try {
    await (params._suggestIdentityLink ?? suggestIdentityLink)({
      githubUsername: params.fixture.githubUsername,
      githubDisplayName: params.fixture.githubDisplayName,
      slackBotToken: "xoxb-test-token",
      profileStore: store,
      logger,
    });
  } catch (error) {
    problems.push(
      `identity suggester threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    resetIdentityState();
  }

  const fetchUrls = capturedRequests.map((request) => request.url);
  const dmRequest = capturedRequests.find(
    (request) => request.url === "https://slack.com/api/chat.postMessage",
  );

  let dmText: string | null = null;
  if (dmRequest?.body) {
    try {
      const parsed = JSON.parse(dmRequest.body) as { text?: unknown };
      dmText = typeof parsed.text === "string" ? parsed.text : null;
      if (!dmText) {
        problems.push("chat.postMessage body was missing text");
      }
    } catch (error) {
      problems.push(
        `chat.postMessage body was malformed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const warningLogged = warningMessages.length > 0;
  const surfaceText = dmText ?? warningMessages.join(" | ");
  const drift = collectSurfaceDrift(
    surfaceText,
    params.fixture.requiredPhrases,
    params.fixture.bannedPhrases,
  );

  if (!arrayEquals(fetchUrls, params.fixture.expectedFetchUrls)) {
    problems.push(
      `fetchUrls=${fetchUrls.join(",") || "none"} expected=${params.fixture.expectedFetchUrls.join(",") || "none"}`,
    );
  }
  if (params.fixture.expectedDm && !dmText) {
    problems.push("expected DM text but none was sent");
  }
  if (!params.fixture.expectedDm && dmText) {
    problems.push("unexpected DM text was sent");
  }
  if (warningLogged !== params.fixture.expectedWarningLogged) {
    problems.push(
      `warningLogged=${warningLogged} expected=${params.fixture.expectedWarningLogged}`,
    );
  }

  const passed =
    problems.length === 0 &&
    drift.missingPhrases.length === 0 &&
    drift.unexpectedPhrases.length === 0;

  return {
    scenarioId: params.fixture.scenarioId,
    description: params.fixture.description,
    dmText,
    warningLogged,
    warningMessages,
    fetchUrls,
    passed,
    statusCode: passed
      ? `${toStatusPrefix(params.fixture.scenarioId)}_identity_truthful`
      : "identity_link_truthfulness_failed",
    detail: buildIdentityDetail({
      scenarioId: params.fixture.scenarioId,
      warningLogged,
      fetchUrls,
      drift,
      problems,
    }),
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
    params.surface === "multi-query" ? !scenario.multiQuery.passed : !scenario.legacyQuery.passed,
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

function buildSlackSurfaceCheck(params: {
  scenarios: SlackScenarioReport[];
}): Check {
  const failingScenarios = params.scenarios.filter((scenario) => !scenario.passed);

  if (failingScenarios.length === 0) {
    return {
      id: "M045-S03-SLACK-SURFACES-CONTRACT",
      passed: true,
      skipped: false,
      status_code: "slack_surface_contract_truthful",
      detail: `checked ${params.scenarios.length} Slack scenarios`,
    };
  }

  return {
    id: "M045-S03-SLACK-SURFACES-CONTRACT",
    passed: false,
    skipped: false,
    status_code: "slack_surface_contract_drift",
    detail: `failing scenarios: ${failingScenarios.map((scenario) => scenario.scenarioId).join(", ")}`,
  };
}

function buildIdentitySurfaceCheck(params: {
  scenarios: IdentityScenarioReport[];
}): Check {
  const failingScenarios = params.scenarios.filter((scenario) => !scenario.passed);

  if (failingScenarios.length === 0) {
    return {
      id: "M045-S03-IDENTITY-LINK-CONTRACT",
      passed: true,
      skipped: false,
      status_code: "identity_link_contract_truthful",
      detail: `checked ${params.scenarios.length} identity scenarios`,
    };
  }

  return {
    id: "M045-S03-IDENTITY-LINK-CONTRACT",
    passed: false,
    skipped: false,
    status_code: "identity_link_contract_drift",
    detail: `failing scenarios: ${failingScenarios.map((scenario) => scenario.scenarioId).join(", ")}`,
  };
}

export async function evaluateM045S03(opts?: {
  generatedAt?: string;
  _evaluateS01?: () => Promise<unknown>;
  _retrievalFixtures?: RetrievalFixture[];
  _buildRetrievalVariants?: (input: BuildRetrievalVariantsInput) => MultiQueryVariant[];
  _buildRetrievalQuery?: (signals: RetrievalQuerySignals) => string;
  _slackFixtures?: SlackFixture[];
  _handleKodiaiCommand?: typeof handleKodiaiCommand;
  _identityFixtures?: IdentityFixture[];
  _suggestIdentityLink?: typeof suggestIdentityLink;
  _resetIdentitySuggestionState?: () => void;
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

  const validatedEmbedded =
    embeddedProblems.length > 0
      ? { report: null, problems: embeddedProblems }
      : validateEmbeddedS01Report(embeddedUnknown);

  const retrievalFixtures = opts?._retrievalFixtures ?? buildM045S03RetrievalFixtures();
  const retrievalScenarios = retrievalFixtures.map((fixture) => ({
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

  const slackFixtures = opts?._slackFixtures ?? buildM045S03SlackFixtures();
  const slackScenarios: SlackScenarioReport[] = [];
  for (const fixture of slackFixtures) {
    slackScenarios.push(
      await evaluateSlackScenario({
        fixture,
        _handleKodiaiCommand: opts?._handleKodiaiCommand,
      }),
    );
  }

  const identityFixtures = opts?._identityFixtures ?? buildM045S03IdentityFixtures();
  const identityScenarios: IdentityScenarioReport[] = [];
  for (const fixture of identityFixtures) {
    identityScenarios.push(
      await evaluateIdentityScenario({
        fixture,
        _suggestIdentityLink: opts?._suggestIdentityLink,
        _resetIdentitySuggestionState: opts?._resetIdentitySuggestionState,
      }),
    );
  }

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
    buildSlackSurfaceCheck({ scenarios: slackScenarios }),
    buildIdentitySurfaceCheck({ scenarios: identityScenarios }),
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
    slack: {
      scenarios: slackScenarios,
    },
    identity: {
      scenarios: identityScenarios,
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

  lines.push("Slack:");
  for (const scenario of report.slack.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} response=${scenario.responseType ?? "none"} ${scenario.passed ? "pass" : "fail"}`,
    );
    if (!scenario.passed && scenario.detail) {
      lines.push(`  detail: ${scenario.detail}`);
    }
  }

  lines.push("Identity link:");
  for (const scenario of report.identity.scenarios) {
    lines.push(
      `- ${scenario.scenarioId} dm=${scenario.dmText ? "yes" : "no"} warning=${scenario.warningLogged ? "yes" : "no"} ${scenario.passed ? "pass" : "fail"}`,
    );
    if (!scenario.passed && scenario.detail) {
      lines.push(`  detail: ${scenario.detail}`);
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
  _slackFixtures?: SlackFixture[];
  _handleKodiaiCommand?: typeof handleKodiaiCommand;
  _identityFixtures?: IdentityFixture[];
  _suggestIdentityLink?: typeof suggestIdentityLink;
  _resetIdentitySuggestionState?: () => void;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const report = await evaluateM045S03({
    _evaluateS01: opts?._evaluateS01,
    _retrievalFixtures: opts?._retrievalFixtures,
    _buildRetrievalVariants: opts?._buildRetrievalVariants,
    _buildRetrievalQuery: opts?._buildRetrievalQuery,
    _slackFixtures: opts?._slackFixtures,
    _handleKodiaiCommand: opts?._handleKodiaiCommand,
    _identityFixtures: opts?._identityFixtures,
    _suggestIdentityLink: opts?._suggestIdentityLink,
    _resetIdentitySuggestionState: opts?._resetIdentitySuggestionState,
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
