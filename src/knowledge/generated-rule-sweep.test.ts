import { describe, expect, it, mock } from "bun:test";
import { createGeneratedRuleSweep } from "./generated-rule-sweep.ts";
import type { Logger } from "pino";
import type { GeneratedRuleRecord, GeneratedRuleStore } from "./generated-rule-store.ts";
import type { MemoryOutcome } from "./types.ts";

function createMockLogger() {
  const logger = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: mock(() => logger),
  };
  return logger as unknown as Logger;
}

function normalizedEmbedding(seed: number, dim = 8): Float32Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = next() * 2 - 1;
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function slightlyAdjustedEmbedding(base: Float32Array, delta: number): Float32Array {
  const arr = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    arr[i] = base[i]! + delta;
  }

  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! / norm;
  return arr;
}

function toVectorString(arr: Float32Array): string {
  return `[${Array.from(arr).join(",")}]`;
}

function makeMemoryRow(overrides: {
  id: number;
  embedding: Float32Array;
  findingText: string;
  outcome?: MemoryOutcome;
  filePath?: string;
}) {
  return {
    id: overrides.id,
    outcome: overrides.outcome ?? "accepted",
    finding_text: overrides.findingText,
    file_path: overrides.filePath ?? `src/file-${overrides.id}.ts`,
    embedding: toVectorString(overrides.embedding),
    created_at: `2026-03-${String((overrides.id % 20) + 1).padStart(2, "0")}T00:00:00Z`,
  };
}

function makePendingRecord(params: {
  id: number;
  repo: string;
  title: string;
  ruleText: string;
  signalScore: number;
  memberCount: number;
  clusterCentroid?: Float32Array;
}): GeneratedRuleRecord {
  return {
    id: params.id,
    repo: params.repo,
    title: params.title,
    ruleText: params.ruleText,
    status: "pending",
    origin: "generated",
    signalScore: params.signalScore,
    memberCount: params.memberCount,
    clusterCentroid: params.clusterCentroid ?? new Float32Array(0),
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:00Z",
    activatedAt: null,
    retiredAt: null,
  };
}

function createPartialStore(overrides?: Partial<GeneratedRuleStore>): GeneratedRuleStore {
  return {
    savePendingRule: mock(async () => makePendingRecord({
      id: 1,
      repo: "xbmc/xbmc",
      title: "rule",
      ruleText: "rule",
      signalScore: 0.5,
      memberCount: 5,
    })) as unknown as GeneratedRuleStore["savePendingRule"],
    getRule: mock(async () => null),
    listRulesForRepo: mock(async () => []),
    getActiveRulesForRepo: mock(async () => []),
    activateRule: mock(async () => null),
    retireRule: mock(async () => null),
    getLifecycleCounts: mock(async () => ({ pending: 0, active: 0, retired: 0, total: 0 })),
    ...overrides,
  } as unknown as GeneratedRuleStore;
}

describe("createGeneratedRuleSweep", () => {
  it("discovers repos, generates proposals from positive clusters, and persists pending rules", async () => {
    const logger = createMockLogger();
    const savedProposals: Array<{ title: string; ruleText: string; repo: string }> = [];
    const base = normalizedEmbedding(10);
    const noisy = normalizedEmbedding(99);

    const sql = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("GROUP BY repo") && query.includes("memory_count")) {
        return [{ repo: "xbmc/xbmc", memory_count: 6 }];
      }

      if (query.includes("SELECT id, outcome, finding_text, file_path, embedding, created_at")) {
        expect(values[0]).toBe("xbmc/xbmc");
        return [
          makeMemoryRow({ id: 1, embedding: base, findingText: "Add an explicit null guard before dereferencing optional pointers when the API can return nullptr." }),
          makeMemoryRow({ id: 2, embedding: slightlyAdjustedEmbedding(base, 0.001), findingText: "Check the pointer for null before calling methods on the optional response object." }),
          makeMemoryRow({ id: 3, embedding: slightlyAdjustedEmbedding(base, -0.001), findingText: "Return early when the optional settings object is null instead of dereferencing it." }),
          makeMemoryRow({ id: 4, embedding: slightlyAdjustedEmbedding(base, 0.002), findingText: "Guard against null before reading members from the optional config object." }),
          makeMemoryRow({ id: 5, embedding: slightlyAdjustedEmbedding(base, -0.002), findingText: "Avoid null dereferences by checking the optional context pointer before using it.", outcome: "thumbs_up" }),
          makeMemoryRow({ id: 9, embedding: noisy, findingText: "Unrelated formatting issue in a different part of the repo." }),
        ];
      }

      throw new Error(`Unexpected SQL query: ${query}`);
    }) as any;

    const store = createPartialStore({
      savePendingRule: mock(async (proposal) => {
        savedProposals.push({ title: proposal.title, ruleText: proposal.ruleText, repo: proposal.repo });
        return makePendingRecord({
          id: savedProposals.length,
          repo: proposal.repo,
          title: proposal.title,
          ruleText: proposal.ruleText,
          signalScore: proposal.signalScore,
          memberCount: proposal.memberCount,
          clusterCentroid: proposal.clusterCentroid,
        });
      }) as unknown as GeneratedRuleStore["savePendingRule"],
    });

    const sweep = createGeneratedRuleSweep({ sql, logger, store });
    const result = await sweep.run();

    expect(result.repoCount).toBe(1);
    expect(result.reposProcessed).toBe(1);
    expect(result.reposWithProposals).toBe(1);
    expect(result.reposFailed).toBe(0);
    expect(result.proposalsGenerated).toBe(1);
    expect(result.proposalsPersisted).toBe(1);
    expect(result.persistFailures).toBe(0);
    expect(result.repoResults[0]!.representativeMemoryIds).toEqual([1]);
    expect(savedProposals.length).toBe(1);
    expect(savedProposals[0]!.repo).toBe("xbmc/xbmc");
    expect(savedProposals[0]!.title.toLowerCase()).toContain("null");
    expect(savedProposals[0]!.ruleText.toLowerCase()).toContain("null");
  });

  it("supports explicit repos and dry-run mode without persistence", async () => {
    const logger = createMockLogger();
    const store = createPartialStore();
    const sweep = createGeneratedRuleSweep({
      sql: mock(async () => []) as any,
      logger,
      store,
      _generateFn: async (repo) => [{
        repo,
        title: "Prefer null guards",
        ruleText: "Add a null guard before dereferencing optional pointers.",
        signalScore: 0.5,
        memberCount: 5,
        clusterCentroid: new Float32Array([1, 0]),
        clusterSize: 5,
        positiveCount: 5,
        negativeCount: 0,
        acceptedCount: 4,
        thumbsUpCount: 1,
        positiveRatio: 1,
        representativeMemoryId: 42,
        representativeFindingText: "Add a null guard before dereferencing optional pointers.",
      }],
    });

    const result = await sweep.run({ repos: ["xbmc/xbmc"], dryRun: true });

    expect(result.repoCount).toBe(1);
    expect(result.proposalsGenerated).toBe(1);
    expect(result.proposalsPersisted).toBe(0);
    expect(result.persistFailures).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(store.savePendingRule).not.toHaveBeenCalled();
  });

  it("keeps sweeping when proposal persistence fails", async () => {
    const logger = createMockLogger();
    let callCount = 0;
    const store = createPartialStore({
      savePendingRule: mock(async (proposal) => {
        callCount++;
        if (callCount === 1) {
          throw new Error(`failed to save ${proposal.title}`);
        }
        return makePendingRecord({
          id: callCount,
          repo: proposal.repo,
          title: proposal.title,
          ruleText: proposal.ruleText,
          signalScore: proposal.signalScore,
          memberCount: proposal.memberCount,
          clusterCentroid: proposal.clusterCentroid,
        });
      }) as unknown as GeneratedRuleStore["savePendingRule"],
    });

    const sweep = createGeneratedRuleSweep({
      sql: mock(async () => []) as any,
      logger,
      store,
      _generateFn: async (repo) => [
        {
          repo,
          title: "Prefer null guards",
          ruleText: "Add a null guard before dereferencing optional pointers.",
          signalScore: 0.5,
          memberCount: 5,
          clusterCentroid: new Float32Array([1, 0]),
          clusterSize: 5,
          positiveCount: 5,
          negativeCount: 0,
          acceptedCount: 4,
          thumbsUpCount: 1,
          positiveRatio: 1,
          representativeMemoryId: 1,
          representativeFindingText: "Add a null guard before dereferencing optional pointers.",
        },
        {
          repo,
          title: "Prefer path validation",
          ruleText: "Validate paths before joining user-controlled directories.",
          signalScore: 0.5,
          memberCount: 5,
          clusterCentroid: new Float32Array([0, 1]),
          clusterSize: 5,
          positiveCount: 5,
          negativeCount: 0,
          acceptedCount: 5,
          thumbsUpCount: 0,
          positiveRatio: 1,
          representativeMemoryId: 2,
          representativeFindingText: "Validate paths before joining user-controlled directories.",
        },
      ],
    });

    const result = await sweep.run({ repos: ["xbmc/xbmc"] });

    expect(result.proposalsGenerated).toBe(2);
    expect(result.proposalsPersisted).toBe(1);
    expect(result.persistFailures).toBe(1);
    expect(result.repoResults[0]!.persistFailureCount).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("keeps sweeping later repos when one repo throws", async () => {
    const logger = createMockLogger();
    const store = createPartialStore();

    const sweep = createGeneratedRuleSweep({
      sql: mock(async () => []) as any,
      logger,
      store,
      _generateFn: async (repo) => {
        if (repo === "broken/repo") {
          throw new Error("proposal generation exploded");
        }
        return [{
          repo,
          title: "Prefer null guards",
          ruleText: "Add a null guard before dereferencing optional pointers.",
          signalScore: 0.5,
          memberCount: 5,
          clusterCentroid: new Float32Array([1, 0]),
          clusterSize: 5,
          positiveCount: 5,
          negativeCount: 0,
          acceptedCount: 4,
          thumbsUpCount: 1,
          positiveRatio: 1,
          representativeMemoryId: 7,
          representativeFindingText: "Add a null guard before dereferencing optional pointers.",
        }];
      },
    });

    const result = await sweep.run({ repos: ["broken/repo", "xbmc/xbmc"] });

    expect(result.repoCount).toBe(2);
    expect(result.reposProcessed).toBe(1);
    expect(result.reposFailed).toBe(1);
    expect(result.proposalsPersisted).toBe(1);
    expect(result.repoResults.map((entry) => entry.repo)).toEqual(["xbmc/xbmc"]);
    expect(logger.warn).toHaveBeenCalled();
  });
});
