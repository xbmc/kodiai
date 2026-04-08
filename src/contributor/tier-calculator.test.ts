import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import {
  calculateTierAssignments,
  calculateTierForProfile,
  recalculateTiers,
} from "./tier-calculator.ts";
import type { ContributorProfileStore, ContributorTier } from "./types.ts";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as Logger;

function createMockStore(
  scores: Array<{ profileId: number; overallScore: number }>,
): {
  store: ContributorProfileStore;
  tierUpdates: Map<number, { tier: ContributorTier; score: number }>;
} {
  const tierUpdates = new Map<
    number,
    { tier: ContributorTier; score: number }
  >();

  const store: ContributorProfileStore = {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async () => ({
      id: 1,
      githubUsername: "",
      slackUserId: null,
      displayName: null,
      overallTier: "newcomer" as const,
      overallScore: 0,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScoredAt: null,
    }),
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => [],
    upsertExpertise: async () => {},
    updateTier: async (profileId, tier, overallScore) => {
      tierUpdates.set(profileId, { tier, score: overallScore });
    },
    getOrCreateByGithubUsername: async () => ({
      id: 1,
      githubUsername: "",
      slackUserId: null,
      displayName: null,
      overallTier: "newcomer" as const,
      overallScore: 0,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScoredAt: null,
    }),
    getAllScores: async () => scores,
  };

  return { store, tierUpdates };
}

describe("calculateTierAssignments", () => {
  test("single contributor with score 0 gets newcomer", () => {
    const assignments = calculateTierAssignments([
      { profileId: 1, overallScore: 0 },
    ]);

    expect(assignments.get(1)?.tier).toBe("newcomer");
  });

  test("10 contributors with varying scores get correct percentile tiers", () => {
    const scores = Array.from({ length: 10 }, (_, i) => ({
      profileId: i + 1,
      overallScore: (i + 1) * 0.1,
    }));

    const assignments = calculateTierAssignments(scores);

    expect(assignments.get(1)?.tier).toBe("newcomer");
    expect(assignments.get(2)?.tier).toBe("newcomer");
    expect(assignments.get(3)?.tier).toBe("developing");
    expect(assignments.get(4)?.tier).toBe("developing");
    expect(assignments.get(5)?.tier).toBe("developing");
    expect(assignments.get(6)?.tier).toBe("established");
    expect(assignments.get(7)?.tier).toBe("established");
    expect(assignments.get(8)?.tier).toBe("established");
    expect(assignments.get(9)?.tier).toBe("senior");
    expect(assignments.get(10)?.tier).toBe("senior");
  });

  test("all contributors with score 0 all get newcomer", () => {
    const scores = Array.from({ length: 5 }, (_, i) => ({
      profileId: i + 1,
      overallScore: 0,
    }));

    const assignments = calculateTierAssignments(scores);

    for (let i = 1; i <= 5; i++) {
      expect(assignments.get(i)?.tier).toBe("newcomer");
    }
  });
});

describe("calculateTierForProfile", () => {
  test("replaces the target profile score before deriving its percentile tier", () => {
    const tier = calculateTierForProfile({
      profileId: 3,
      updatedOverallScore: 0.57,
      scores: [
        { profileId: 1, overallScore: 0.08 },
        { profileId: 2, overallScore: 0.16 },
        { profileId: 3, overallScore: 0.24 },
        { profileId: 4, overallScore: 0.41 },
        { profileId: 5, overallScore: 0.56 },
        { profileId: 6, overallScore: 0.72 },
      ],
    });

    expect(tier).toBe("senior");
  });

  test("does not throw when the target profile is absent from the existing scores list", () => {
    expect(() =>
      calculateTierForProfile({
        profileId: 9,
        updatedOverallScore: 0.5,
        scores: [],
      }),
    ).not.toThrow();
  });
});

describe("recalculateTiers", () => {
  test("writes the same assignments through the batch updater", async () => {
    const scores = Array.from({ length: 10 }, (_, i) => ({
      profileId: i + 1,
      overallScore: (i + 1) * 0.1,
    }));

    const { store, tierUpdates } = createMockStore(scores);
    await recalculateTiers({ profileStore: store, logger: mockLogger });

    expect(tierUpdates.get(1)?.tier).toBe("newcomer");
    expect(tierUpdates.get(5)?.tier).toBe("developing");
    expect(tierUpdates.get(7)?.tier).toBe("established");
    expect(tierUpdates.get(10)?.tier).toBe("senior");
  });

  test("empty profile list does not error", async () => {
    const { store, tierUpdates } = createMockStore([]);
    await recalculateTiers({ profileStore: store, logger: mockLogger });
    expect(tierUpdates.size).toBe(0);
  });
});
