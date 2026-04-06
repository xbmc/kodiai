/**
 * Unit tests for suggestion-cluster-refresh.ts.
 *
 * All tests use pure-code stubs — no DB, no HDBSCAN, no network.
 */

import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import {
  createClusterRefresh,
  type ClusterRefreshResult,
  type ClusterRefreshRunOpts,
} from "./suggestion-cluster-refresh.ts";
import type {
  SuggestionClusterStore,
  SuggestionClusterModel,
  SuggestionClusterModelPayload,
} from "./suggestion-cluster-store.ts";
import type { BuildClusterModelResult } from "./suggestion-cluster-builder.ts";

// ── Helpers ───────────────────────────────────────────────────────────

function createSilentLogger(): Logger {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger as unknown as Logger;
}

function createWarnSpyLogger(): Logger & { _warnCalls: unknown[][] } {
  const warnCalls: unknown[][] = [];
  const logger = {
    _warnCalls: warnCalls,
    info: () => {},
    warn: (...args: unknown[]) => { warnCalls.push(args); },
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger as unknown as Logger & { _warnCalls: unknown[][] };
}

function createInfoSpyLogger(): Logger & { _infoCalls: unknown[][] } {
  const infoCalls: unknown[][] = [];
  const logger = {
    _infoCalls: infoCalls,
    info: (...args: unknown[]) => { infoCalls.push(args); },
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger as unknown as Logger & { _infoCalls: unknown[][] };
}

function createNullStore(expiredRepos: string[] = []): SuggestionClusterStore {
  return {
    getModel: async () => null,
    getModelIncludingStale: async () => null,
    saveModel: async (p: SuggestionClusterModelPayload): Promise<SuggestionClusterModel> => ({
      id: 1,
      repo: p.repo,
      positiveCentroids: p.positiveCentroids,
      negativeCentroids: p.negativeCentroids,
      memberCount: p.memberCount,
      positiveMemberCount: p.positiveMemberCount,
      negativeMemberCount: p.negativeMemberCount,
      builtAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    deleteModel: async () => {},
    listExpiredModelRepos: async () => expiredRepos,
  };
}

function makeSuccessfulBuildFn(positiveCentroidCount = 2, negativeCentroidCount = 1) {
  return async ({ repo }: { repo: string }): Promise<BuildClusterModelResult> => ({
    repo,
    built: true,
    model: null,
    positiveCentroidCount,
    negativeCentroidCount,
    positiveMemberCount: positiveCentroidCount * 4,
    negativeMemberCount: negativeCentroidCount * 3,
    skippedClusters: 0,
  });
}

function makeSkipBuildFn(skipReason = "Insufficient data") {
  return async ({ repo }: { repo: string }): Promise<BuildClusterModelResult> => ({
    repo,
    built: false,
    model: null,
    positiveCentroidCount: 0,
    negativeCentroidCount: 0,
    positiveMemberCount: 0,
    negativeMemberCount: 0,
    skippedClusters: 0,
    skipReason,
  });
}

function makeCrashBuildFn(crashRepo: string) {
  return async ({ repo }: { repo: string }): Promise<BuildClusterModelResult> => {
    if (repo === crashRepo) throw new Error(`Simulated crash for ${crashRepo}`);
    return {
      repo,
      built: true,
      model: null,
      positiveCentroidCount: 1,
      negativeCentroidCount: 1,
      positiveMemberCount: 5,
      negativeMemberCount: 5,
      skippedClusters: 0,
    };
  };
}

const createNoopSql = () => (() => Promise.resolve([])) as unknown as import("../db/client.ts").Sql;

// ── run() with explicit repos ─────────────────────────────────────────

describe("run() with explicit repos", () => {
  test("returns correct totals for all-built repos", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(2, 1),
    });

    const result: ClusterRefreshResult = await refresh.run({ repos: ["org/a", "org/b", "org/c"] });

    expect(result.repoCount).toBe(3);
    expect(result.reposBuilt).toBe(3);
    expect(result.reposSkipped).toBe(0);
    expect(result.reposFailed).toBe(0);
    expect(result.totalPositiveCentroids).toBe(6); // 2 * 3 repos
    expect(result.totalNegativeCentroids).toBe(3); // 1 * 3 repos
    expect(result.repoResults.length).toBe(3);
  });

  test("all repos present in repoResults", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(),
    });

    const result = await refresh.run({ repos: ["org/a", "org/b"] });
    const repos = result.repoResults.map((r) => r.repo);
    expect(repos).toContain("org/a");
    expect(repos).toContain("org/b");
  });

  test("built=true and failed=false on successful build", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(3, 2),
    });

    const result = await refresh.run({ repos: ["org/x"] });
    const repo = result.repoResults[0]!;
    expect(repo.built).toBe(true);
    expect(repo.failed).toBe(false);
    expect(repo.positiveCentroidCount).toBe(3);
    expect(repo.negativeCentroidCount).toBe(2);
  });

  test("skips repos with insufficient data and accumulates skippedCount", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeSkipBuildFn("Not enough data"),
    });

    const result = await refresh.run({ repos: ["org/a", "org/b"] });

    expect(result.repoCount).toBe(2);
    expect(result.reposBuilt).toBe(0);
    expect(result.reposSkipped).toBe(2);
    expect(result.reposFailed).toBe(0);
    expect(result.totalPositiveCentroids).toBe(0);
    expect(result.totalNegativeCentroids).toBe(0);
  });

  test("skipReason is propagated to repoResults when built=false", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeSkipBuildFn("Insufficient data: positive=2, negative=1"),
    });

    const result = await refresh.run({ repos: ["org/cold"] });
    const repo = result.repoResults[0]!;
    expect(repo.built).toBe(false);
    expect(repo.failed).toBe(false);
    expect(repo.skipReason).toContain("Insufficient data");
  });

  test("empty explicit repos list returns zero totals without calling buildFn", async () => {
    let buildCallCount = 0;
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: async (opts) => { buildCallCount++; return makeSuccessfulBuildFn()(opts); },
    });

    const result = await refresh.run({ repos: [] });

    // Empty repos → falls through to store.listExpiredModelRepos (which also returns [])
    expect(result.repoCount).toBe(0);
    expect(result.reposBuilt).toBe(0);
    expect(buildCallCount).toBe(0);
  });
});

// ── run() from expired store ──────────────────────────────────────────

describe("run() sweeping expired repos from store", () => {
  test("fetches expired repos from store when no explicit repos provided", async () => {
    const expiredRepos = ["org/stale-a", "org/stale-b"];
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(expiredRepos),
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(1, 0),
    });

    const result = await refresh.run(); // no runOpts

    expect(result.repoCount).toBe(2);
    expect(result.reposBuilt).toBe(2);
  });

  test("returns zero when no expired repos in store", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore([]),  // empty
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(),
    });

    const result = await refresh.run();

    expect(result.repoCount).toBe(0);
    expect(result.reposBuilt).toBe(0);
    expect(result.repoResults.length).toBe(0);
  });

  test("respects maxReposPerRun option", async () => {
    // Store has 5 but maxReposPerRun caps at 2
    const capturedLimits: number[] = [];
    const limitedStore: SuggestionClusterStore = {
      ...createNullStore(),
      listExpiredModelRepos: async (limit?: number) => {
        capturedLimits.push(limit ?? -1);
        return ["org/a", "org/b"];
      },
    };

    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: limitedStore,
      logger: createSilentLogger(),
      maxReposPerRun: 2,
      _buildFn: makeSuccessfulBuildFn(),
    });

    await refresh.run();

    expect(capturedLimits.length).toBe(1);
    expect(capturedLimits[0]).toBe(2);
  });

  test("default maxReposPerRun is 50", async () => {
    const capturedLimits: number[] = [];
    const spyStore: SuggestionClusterStore = {
      ...createNullStore(),
      listExpiredModelRepos: async (limit?: number) => {
        capturedLimits.push(limit ?? -1);
        return [];
      },
    };

    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: spyStore,
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(),
    });

    await refresh.run();
    expect(capturedLimits[0]).toBe(50);
  });
});

// ── Fail-open behavior ────────────────────────────────────────────────

describe("fail-open: sweep continues after individual build failures", () => {
  test("continues sweep when one repo's build throws", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeCrashBuildFn("org/crashing"),
    });

    const result = await refresh.run({ repos: ["org/crashing", "org/healthy"] });

    expect(result.repoCount).toBe(2);
    expect(result.reposFailed).toBe(1);
    expect(result.reposBuilt).toBe(1);
    expect(result.totalPositiveCentroids).toBe(1); // only healthy contributes
  });

  test("failed repo has failed=true in repoResults", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeCrashBuildFn("org/bad"),
    });

    const result = await refresh.run({ repos: ["org/bad"] });
    const repo = result.repoResults[0]!;
    expect(repo.failed).toBe(true);
    expect(repo.built).toBe(false);
    expect(repo.skipReason).toContain("Error");
  });

  test("emits warn log for each failed repo", async () => {
    const spyLogger = createWarnSpyLogger();
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: spyLogger,
      _buildFn: makeCrashBuildFn("org/crash1"),
    });

    await refresh.run({ repos: ["org/crash1", "org/ok"] });

    expect(spyLogger._warnCalls.length).toBeGreaterThanOrEqual(1);
    const firstWarn = JSON.stringify(spyLogger._warnCalls[0]);
    expect(firstWarn).toContain("org/crash1");
  });

  test("healthy repos still accumulate totals after earlier crash", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeCrashBuildFn("org/first-fails"),
    });

    const result = await refresh.run({
      repos: ["org/first-fails", "org/ok1", "org/ok2"],
    });

    expect(result.reposFailed).toBe(1);
    expect(result.reposBuilt).toBe(2);
    expect(result.totalPositiveCentroids).toBe(2);
    expect(result.totalNegativeCentroids).toBe(2);
  });

  test("all repos crash — reposFailed equals repoCount", async () => {
    const alwaysCrash = async () => { throw new Error("always crashes"); };
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: alwaysCrash as never,
    });

    const result = await refresh.run({ repos: ["org/a", "org/b", "org/c"] });

    expect(result.reposFailed).toBe(3);
    expect(result.reposBuilt).toBe(0);
    expect(result.repoCount).toBe(3);
  });
});

// ── Mixed built/skipped/failed ────────────────────────────────────────

describe("mixed outcomes", () => {
  test("correctly tallies built, skipped, and failed in one sweep", async () => {
    const mixedFn = async ({ repo }: { repo: string }): Promise<BuildClusterModelResult> => {
      if (repo === "org/crash") throw new Error("crash");
      if (repo === "org/skip") return { repo, built: false, model: null, positiveCentroidCount: 0, negativeCentroidCount: 0, positiveMemberCount: 0, negativeMemberCount: 0, skippedClusters: 0, skipReason: "low data" };
      return { repo, built: true, model: null, positiveCentroidCount: 2, negativeCentroidCount: 1, positiveMemberCount: 8, negativeMemberCount: 4, skippedClusters: 0 };
    };

    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: mixedFn,
    });

    const result = await refresh.run({ repos: ["org/built", "org/skip", "org/crash"] });

    expect(result.repoCount).toBe(3);
    expect(result.reposBuilt).toBe(1);
    expect(result.reposSkipped).toBe(1);
    expect(result.reposFailed).toBe(1);
    expect(result.totalPositiveCentroids).toBe(2);
    expect(result.totalNegativeCentroids).toBe(1);
  });
});

// ── Result shape and observability ───────────────────────────────────

describe("result shape", () => {
  test("durationMs is a non-negative number", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(["org/a"]),
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(),
    });

    const result = await refresh.run();
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("repoResults length equals repoCount", async () => {
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: makeSuccessfulBuildFn(),
    });

    const result = await refresh.run({ repos: ["a", "b", "c"] });
    expect(result.repoResults.length).toBe(result.repoCount);
  });

  test("sum of reposBuilt + reposSkipped + reposFailed equals repoCount", async () => {
    const mixedFn = async ({ repo }: { repo: string }): Promise<BuildClusterModelResult> => {
      if (repo === "org/crash") throw new Error("x");
      if (repo === "org/skip") return { repo, built: false, model: null, positiveCentroidCount: 0, negativeCentroidCount: 0, positiveMemberCount: 0, negativeMemberCount: 0, skippedClusters: 0 };
      return { repo, built: true, model: null, positiveCentroidCount: 1, negativeCentroidCount: 0, positiveMemberCount: 5, negativeMemberCount: 0, skippedClusters: 0 };
    };

    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: createSilentLogger(),
      _buildFn: mixedFn,
    });

    const result = await refresh.run({ repos: ["org/built", "org/skip", "org/crash"] });
    expect(result.reposBuilt + result.reposSkipped + result.reposFailed).toBe(result.repoCount);
  });

  test("emits info log with sweep totals on completion", async () => {
    const spyLogger = createInfoSpyLogger();
    const refresh = createClusterRefresh({
      sql: createNoopSql(),
      store: createNullStore(),
      logger: spyLogger,
      _buildFn: makeSuccessfulBuildFn(2, 1),
    });

    await refresh.run({ repos: ["org/a"] });

    const summaryLog = spyLogger._infoCalls.find(
      (args) => JSON.stringify(args).includes("sweep complete"),
    );
    expect(summaryLog).toBeDefined();
  });
});
