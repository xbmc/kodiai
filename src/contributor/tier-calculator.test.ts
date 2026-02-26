import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import { recalculateTiers } from "./tier-calculator.ts";
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

describe("recalculateTiers", () => {
  test("single contributor with score 0 gets newcomer", async () => {
    const { store, tierUpdates } = createMockStore([
      { profileId: 1, overallScore: 0 },
    ]);

    await recalculateTiers({ profileStore: store, logger: mockLogger });

    expect(tierUpdates.get(1)?.tier).toBe("newcomer");
  });

  test("10 contributors with varying scores get correct percentile tiers", async () => {
    // Create 10 contributors with scores 0.1 to 1.0
    const scores = Array.from({ length: 10 }, (_, i) => ({
      profileId: i + 1,
      overallScore: (i + 1) * 0.1,
    }));

    const { store, tierUpdates } = createMockStore(scores);
    await recalculateTiers({ profileStore: store, logger: mockLogger });

    // Bottom 20% (indices 0-1, profiles 1-2) = newcomer
    expect(tierUpdates.get(1)?.tier).toBe("newcomer");
    expect(tierUpdates.get(2)?.tier).toBe("newcomer");

    // 20-50% (indices 2-4, profiles 3-5) = developing
    expect(tierUpdates.get(3)?.tier).toBe("developing");
    expect(tierUpdates.get(4)?.tier).toBe("developing");
    expect(tierUpdates.get(5)?.tier).toBe("developing");

    // 50-80% (indices 5-7, profiles 6-8) = established
    expect(tierUpdates.get(6)?.tier).toBe("established");
    expect(tierUpdates.get(7)?.tier).toBe("established");
    expect(tierUpdates.get(8)?.tier).toBe("established");

    // Top 20% (indices 8-9, profiles 9-10) = senior
    expect(tierUpdates.get(9)?.tier).toBe("senior");
    expect(tierUpdates.get(10)?.tier).toBe("senior");
  });

  test("all contributors with score 0 all get newcomer", async () => {
    const scores = Array.from({ length: 5 }, (_, i) => ({
      profileId: i + 1,
      overallScore: 0,
    }));

    const { store, tierUpdates } = createMockStore(scores);
    await recalculateTiers({ profileStore: store, logger: mockLogger });

    for (let i = 1; i <= 5; i++) {
      expect(tierUpdates.get(i)?.tier).toBe("newcomer");
    }
  });

  test("empty profile list does not error", async () => {
    const { store, tierUpdates } = createMockStore([]);
    await recalculateTiers({ profileStore: store, logger: mockLogger });
    expect(tierUpdates.size).toBe(0);
  });
});
