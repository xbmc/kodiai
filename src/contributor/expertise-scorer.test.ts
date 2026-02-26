import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import {
  extractFileArea,
  computeDecayedScore,
  normalizeScore,
  updateExpertiseIncremental,
  type ActivitySignal,
} from "./expertise-scorer.ts";
import type { ContributorProfileStore, ContributorExpertise } from "./types.ts";

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
      { type: "commit", date: now, languages: ["typescript"], fileAreas: ["src/handlers/"] },
    ];
    const oldSignals: ActivitySignal[] = [
      { type: "commit", date: halfLifeAgo, languages: ["typescript"], fileAreas: ["src/handlers/"] },
    ];

    const recentScore = computeDecayedScore(recentSignals);
    const oldScore = computeDecayedScore(oldSignals);

    // Recent should be ~2x old (half-life decay)
    expect(recentScore / oldScore).toBeCloseTo(2, 0);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  test("higher weight for pr_authored than commit", () => {
    const now = new Date();
    const commitSignals: ActivitySignal[] = [
      { type: "commit", date: now, languages: ["typescript"], fileAreas: ["src/"] },
    ];
    const prSignals: ActivitySignal[] = [
      { type: "pr_authored", date: now, languages: ["typescript"], fileAreas: ["src/"] },
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

describe("updateExpertiseIncremental", () => {
  test("calls upsertExpertise for each language and file area", async () => {
    const upsertCalls: Array<{
      dimension: string;
      topic: string;
    }> = [];

    const mockStore: ContributorProfileStore = {
      getByGithubUsername: async () => null,
      getBySlackUserId: async () => null,
      linkIdentity: async () => ({
        id: 1,
        githubUsername: "test",
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
      upsertExpertise: async (params) => {
        upsertCalls.push({
          dimension: params.dimension,
          topic: params.topic,
        });
      },
      updateTier: async () => {},
      getOrCreateByGithubUsername: async () => ({
        id: 1,
        githubUsername: "test",
        slackUserId: null,
        displayName: null,
        overallTier: "newcomer" as const,
        overallScore: 0,
        optedOut: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: null,
      }),
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
      logger: mockLogger,
    });

    // Should have language entries (typescript, python) + file_area entries (src/handlers/, src/lib/)
    const languageCalls = upsertCalls.filter(
      (c) => c.dimension === "language",
    );
    const areaCalls = upsertCalls.filter(
      (c) => c.dimension === "file_area",
    );

    expect(languageCalls.length).toBe(2); // typescript, python
    expect(areaCalls.length).toBe(2); // src/handlers/, src/lib/
    expect(languageCalls.some((c) => c.topic === "typescript")).toBe(true);
    expect(languageCalls.some((c) => c.topic === "python")).toBe(true);
    expect(areaCalls.some((c) => c.topic === "src/handlers/")).toBe(true);
    expect(areaCalls.some((c) => c.topic === "src/lib/")).toBe(true);
  });
});
