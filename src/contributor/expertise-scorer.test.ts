import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import {
  extractFileArea,
  computeDecayedScore,
  normalizeScore,
  updateExpertiseIncremental,
  deriveUpdatedOverallScore,
  recalculateTierFailOpen,
  type ActivitySignal,
} from "./expertise-scorer.ts";
import type {
  ContributorProfileStore,
  ContributorExpertise,
  ContributorProfile,
  ContributorTier,
} from "./types.ts";

function createMockLogger() {
  const warnCalls: unknown[][] = [];

  const logger = {
    info: () => {},
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: "silent",
  } as unknown as Logger;

  return { logger, warnCalls };
}

describe("extractFileArea", () => {
  test("extracts two-level directory prefix", () => {
    expect(extractFileArea("src/handlers/review.ts")).toBe("src/handlers/");
  });

  test("extracts two-level for deeper paths", () => {
    expect(extractFileArea("src/knowledge/wiki/store.ts")).toBe(
      "src/knowledge/",
    );
  });

  test("handles root-level files", () => {
    expect(extractFileArea("package.json")).toBe(".");
  });

  test("normalizes to lowercase", () => {
    expect(extractFileArea("Src/Handlers/review.ts")).toBe("src/handlers/");
  });
});

describe("computeDecayedScore", () => {
  test("applies exponential decay — today signal stronger than 180 days ago", () => {
    const now = new Date();
    const halfLifeAgo = new Date(
      now.getTime() - 180 * 24 * 60 * 60 * 1000,
    );

    const recentSignals: ActivitySignal[] = [
      {
        type: "commit",
        date: now,
        languages: ["typescript"],
        fileAreas: ["src/handlers/"],
      },
    ];
    const oldSignals: ActivitySignal[] = [
      {
        type: "commit",
        date: halfLifeAgo,
        languages: ["typescript"],
        fileAreas: ["src/handlers/"],
      },
    ];

    const recentScore = computeDecayedScore(recentSignals);
    const oldScore = computeDecayedScore(oldSignals);

    expect(recentScore / oldScore).toBeCloseTo(2, 0);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  test("higher weight for pr_authored than commit", () => {
    const now = new Date();
    const commitSignals: ActivitySignal[] = [
      {
        type: "commit",
        date: now,
        languages: ["typescript"],
        fileAreas: ["src/"],
      },
    ];
    const prSignals: ActivitySignal[] = [
      {
        type: "pr_authored",
        date: now,
        languages: ["typescript"],
        fileAreas: ["src/"],
      },
    ];

    expect(computeDecayedScore(prSignals)).toBeGreaterThan(
      computeDecayedScore(commitSignals),
    );
  });
});

describe("normalizeScore", () => {
  test("returns value between 0 and 1", () => {
    const score = normalizeScore(50);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("normalizeScore(0) returns value near 0.08", () => {
    const score = normalizeScore(0);
    expect(score).toBeCloseTo(0.076, 1);
  });

  test("normalizeScore(100) returns value near 0.99", () => {
    const score = normalizeScore(100);
    expect(score).toBeGreaterThan(0.92);
    expect(score).toBeLessThan(1.0);
  });

  test("normalizeScore(50) is ~0.5 (sigmoid midpoint)", () => {
    expect(normalizeScore(50)).toBeCloseTo(0.5, 1);
  });
});

describe("deriveUpdatedOverallScore", () => {
  test("updates only the touched expertise topics before averaging the top five", () => {
    const expertise = [
      makeExpertise({ dimension: "language", topic: "typescript", score: 0.2 }),
      makeExpertise({ dimension: "language", topic: "python", score: 0.91 }),
      makeExpertise({ dimension: "file_area", topic: "src/handlers/", score: 0.35 }),
      makeExpertise({ dimension: "file_area", topic: "src/lib/", score: 0.84 }),
      makeExpertise({ dimension: "language", topic: "rust", score: 0.63 }),
      makeExpertise({ dimension: "file_area", topic: "docs/", score: 0.18 }),
    ];

    const updatedScore = deriveUpdatedOverallScore({
      existingExpertise: expertise,
      touchedTopics: [
        { dimension: "language", topic: "typescript" },
        { dimension: "file_area", topic: "src/handlers/" },
      ],
      signal: {
        type: "pr_authored",
        date: new Date(),
        languages: ["typescript"],
        fileAreas: ["src/handlers/"],
      },
    });

    const expectedTypescriptScore = 0.2 * 0.9 + normalizeScore(3) * 0.1;
    const expectedHandlersScore = 0.35 * 0.9 + normalizeScore(3) * 0.1;
    const expectedTopFiveAverage =
      (0.91 + 0.84 + 0.63 + expectedHandlersScore + expectedTypescriptScore) /
      5;

    expect(updatedScore).toBeCloseTo(expectedTopFiveAverage, 6);
  });
});

describe("recalculateTierFailOpen", () => {
  test("returns fallback tier and logs a warning when score snapshot lookup fails", async () => {
    const { logger, warnCalls } = createMockLogger();
    const store = createIncrementalMockStore({
      getAllScoresError: new Error("db unavailable"),
    });

    const result = await recalculateTierFailOpen({
      profileId: 3,
      updatedOverallScore: 0.57,
      fallbackTier: "newcomer",
      profileStore: store,
      logger,
    });

    expect(result).toBe("newcomer");
    expect(warnCalls).toHaveLength(1);
    expect(String(warnCalls[0]?.[1])).toContain(
      "Contributor tier recalculation failed",
    );
  });
});

describe("updateExpertiseIncremental", () => {
  test("calls upsertExpertise for each language and file area", async () => {
    const upsertCalls: Array<{
      dimension: string;
      topic: string;
    }> = [];

    const { logger } = createMockLogger();
    const mockStore: ContributorProfileStore = {
      getByGithubUsername: async () => null,
      getBySlackUserId: async () => null,
      linkIdentity: async () => makeProfile(),
      unlinkSlack: async () => {},
      setOptedOut: async () => {},
      getExpertise: async () => [],
      upsertExpertise: async (params) => {
        upsertCalls.push({
          dimension: params.dimension,
          topic: params.topic,
        });
      },
      updateTier: async () => {},
      getOrCreateByGithubUsername: async () => makeProfile(),
      getAllScores: async () => [],
    };

    await updateExpertiseIncremental({
      githubUsername: "test",
      filesChanged: [
        "src/handlers/review.ts",
        "src/handlers/mention.ts",
        "src/lib/utils.py",
      ],
      type: "pr_authored",
      profileStore: mockStore,
      logger,
    });

    const languageCalls = upsertCalls.filter(
      (c) => c.dimension === "language",
    );
    const areaCalls = upsertCalls.filter(
      (c) => c.dimension === "file_area",
    );

    expect(languageCalls.length).toBe(2);
    expect(areaCalls.length).toBe(2);
    expect(languageCalls.some((c) => c.topic === "typescript")).toBe(true);
    expect(languageCalls.some((c) => c.topic === "python")).toBe(true);
    expect(areaCalls.some((c) => c.topic === "src/handlers/")).toBe(true);
    expect(areaCalls.some((c) => c.topic === "src/lib/")).toBe(true);
  });

  test("recalculates and persists an advanced tier when the updated score outranks the lowest cohort", async () => {
    const updateTierCalls: Array<{
      profileId: number;
      tier: ContributorTier;
      overallScore: number;
    }> = [];
    const { logger } = createMockLogger();
    const profile = makeProfile({
      githubUsername: "crystalp",
      overallTier: "newcomer",
      overallScore: 0.24,
    });

    const expertise = [
      makeExpertise({ dimension: "language", topic: "typescript", score: 0.25 }),
      makeExpertise({ dimension: "file_area", topic: "src/handlers/", score: 0.3 }),
      makeExpertise({ dimension: "language", topic: "python", score: 0.92 }),
      makeExpertise({ dimension: "file_area", topic: "src/lib/", score: 0.81 }),
      makeExpertise({ dimension: "language", topic: "rust", score: 0.74 }),
    ];

    const mockStore = createIncrementalMockStore({
      profile,
      expertise,
      allScores: [
        { profileId: 1, overallScore: 0.08 },
        { profileId: 2, overallScore: 0.16 },
        { profileId: 3, overallScore: 0.24 },
        { profileId: 4, overallScore: 0.41 },
        { profileId: 5, overallScore: 0.56 },
        { profileId: 6, overallScore: 0.72 },
      ],
      onUpdateTier: (call) => updateTierCalls.push(call),
    });

    await updateExpertiseIncremental({
      githubUsername: "crystalp",
      filesChanged: ["src/handlers/review.ts"],
      type: "pr_authored",
      profileStore: mockStore,
      logger,
    });

    expect(updateTierCalls).toHaveLength(1);
    const persisted = updateTierCalls[0]!;
    expect(persisted.overallScore).toBeGreaterThan(0.56);
    expect(persisted.overallScore).toBeLessThan(0.72);
    expect(persisted.tier).toBe("senior");
  });

  test("persists the existing tier when recalculation dependencies fail open", async () => {
    const updateTierCalls: Array<{
      profileId: number;
      tier: ContributorTier;
      overallScore: number;
    }> = [];
    const { logger, warnCalls } = createMockLogger();
    const profile = makeProfile({
      githubUsername: "crystalp",
      overallTier: "newcomer",
      overallScore: 0.24,
    });

    const mockStore = createIncrementalMockStore({
      profile,
      expertise: [
        makeExpertise({ dimension: "language", topic: "typescript", score: 0.25 }),
        makeExpertise({ dimension: "file_area", topic: "src/handlers/", score: 0.3 }),
        makeExpertise({ dimension: "language", topic: "python", score: 0.92 }),
        makeExpertise({ dimension: "file_area", topic: "src/lib/", score: 0.81 }),
        makeExpertise({ dimension: "language", topic: "rust", score: 0.74 }),
      ],
      getAllScoresError: new Error("snapshot unavailable"),
      onUpdateTier: (call) => updateTierCalls.push(call),
    });

    await updateExpertiseIncremental({
      githubUsername: "crystalp",
      filesChanged: ["src/handlers/review.ts"],
      type: "pr_authored",
      profileStore: mockStore,
      logger,
    });

    expect(updateTierCalls).toHaveLength(1);
    expect(updateTierCalls[0]?.tier).toBe("newcomer");
    expect(updateTierCalls[0]?.overallScore).toBeGreaterThan(0.56);
    expect(warnCalls).toHaveLength(1);
  });
});

function makeProfile(
  overrides: Partial<ContributorProfile> = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "test",
    slackUserId: null,
    displayName: null,
    overallTier: "newcomer",
    overallScore: 0,
    optedOut: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastScoredAt: null,
    ...overrides,
  };
}

function makeExpertise(
  overrides: Partial<ContributorExpertise> & {
    dimension: ContributorExpertise["dimension"];
    topic: string;
    score: number;
  },
): ContributorExpertise {
  return {
    id: 1,
    profileId: 1,
    rawSignals: 1,
    lastActive: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    dimension: overrides.dimension,
    topic: overrides.topic,
    score: overrides.score,
  };
}

function createIncrementalMockStore(params: {
  profile?: ContributorProfile;
  expertise?: ContributorExpertise[];
  allScores?: Array<{ profileId: number; overallScore: number }>;
  getAllScoresError?: Error;
  onUpdateTier?: (call: {
    profileId: number;
    tier: ContributorTier;
    overallScore: number;
  }) => void;
} = {}): ContributorProfileStore {
  const profile = params.profile ?? makeProfile();
  const expertise = params.expertise ?? [];
  const allScores = params.allScores ?? [];

  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async () => profile,
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => expertise,
    upsertExpertise: async () => {},
    updateTier: async (profileId, tier, overallScore) => {
      params.onUpdateTier?.({ profileId, tier, overallScore });
    },
    getOrCreateByGithubUsername: async () => profile,
    getAllScores: async () => {
      if (params.getAllScoresError) {
        throw params.getAllScoresError;
      }
      return allScores;
    },
  };
}
