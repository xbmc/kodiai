/**
 * Tests for suggestion-cluster-staleness.ts
 *
 * Covers:
 * - evaluateModelStaleness: fresh / stale / very-stale / missing paths
 * - resolveModelForScoring: observability signals (logger bindings) + returned model
 * - Grace period boundary conditions (at/just-inside/just-outside)
 * - Store error fallback (fail-open)
 * - formatStalenessDescription output shape
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  evaluateModelStaleness,
  resolveModelForScoring,
  formatStalenessDescription,
  CLUSTER_MODEL_STALE_GRACE_MS,
  CLUSTER_MODEL_TTL_MS,
  type ModelStalenessResult,
} from "./suggestion-cluster-staleness.ts";
import type { SuggestionClusterModel, SuggestionClusterStore } from "./suggestion-cluster-store.ts";

// ── Logger mock ───────────────────────────────────────────────────────

type LogCall = { args: unknown[] };

function createMockLogger() {
  const debugCalls: LogCall[] = [];
  const infoCalls: LogCall[] = [];
  const warnCalls: LogCall[] = [];

  const logger = {
    debug: mock((...args: unknown[]) => { debugCalls.push({ args }); }),
    info: mock((...args: unknown[]) => { infoCalls.push({ args }); }),
    warn: mock((...args: unknown[]) => { warnCalls.push({ args }); }),
    error: mock(() => {}),
    child: mock(() => logger),
  } as unknown as import("pino").Logger;

  return { logger, debugCalls, infoCalls, warnCalls };
}

// ── Model factories ───────────────────────────────────────────────────

function makeCentroid(dim = 4): Float32Array {
  return new Float32Array(Array.from({ length: dim }, (_, i) => i * 0.1));
}

const CENTROID = makeCentroid();

function makeModel(overrides: Partial<SuggestionClusterModel> = {}): SuggestionClusterModel {
  const now = Date.now();
  const builtAt = new Date(now - 60_000).toISOString();           // built 1 min ago
  const expiresAt = new Date(now + CLUSTER_MODEL_TTL_MS - 60_000).toISOString(); // expires in ~24h

  return {
    id: 1,
    repo: "test/repo",
    positiveCentroids: [CENTROID],
    negativeCentroids: [CENTROID],
    memberCount: 20,
    positiveMemberCount: 10,
    negativeMemberCount: 10,
    builtAt,
    expiresAt,
    createdAt: builtAt,
    updatedAt: builtAt,
    ...overrides,
  };
}

/** Build a model already expired by `expiredByMs` milliseconds. */
function makeExpiredModel(expiredByMs: number): SuggestionClusterModel {
  const now = Date.now();
  const expiresAt = new Date(now - expiredByMs);
  const builtAt = new Date(expiresAt.getTime() - CLUSTER_MODEL_TTL_MS);
  return makeModel({
    builtAt: builtAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

// ── Store mock ────────────────────────────────────────────────────────

function makeStore(returnedModel: SuggestionClusterModel | null | "throw"): SuggestionClusterStore {
  return {
    getModel: mock(async () => null),
    getModelIncludingStale: mock(async () => {
      if (returnedModel === "throw") throw new Error("DB unavailable");
      return returnedModel;
    }),
    saveModel: mock(async () => { throw new Error("not implemented"); }),
    deleteModel: mock(async () => {}),
    listExpiredModelRepos: mock(async () => []),
  };
}

// ── evaluateModelStaleness ────────────────────────────────────────────

describe("evaluateModelStaleness", () => {
  it("returns missing when model is null", () => {
    const result = evaluateModelStaleness(null);
    expect(result.status).toBe("missing");
    expect(result.modelAgeMs).toBeNull();
    expect(result.expiredByMs).toBeNull();
  });

  it("returns fresh for a model not yet expired", () => {
    const model = makeModel();
    const nowMs = Date.now();
    const result = evaluateModelStaleness(model, nowMs);

    expect(result.status).toBe("fresh");
    expect(result.expiredByMs).toBe(0);
    expect(result.modelAgeMs).toBeGreaterThan(0);
    // Age should be close to 1 minute (built 1 min ago in makeModel)
    expect(result.modelAgeMs!).toBeGreaterThanOrEqual(0);
    expect(result.modelAgeMs!).toBeLessThan(CLUSTER_MODEL_TTL_MS);
  });

  it("returns stale just after expiry (1ms past)", () => {
    const model = makeExpiredModel(1);
    const nowMs = Date.now();
    const result = evaluateModelStaleness(model, nowMs);

    expect(result.status).toBe("stale");
    expect(result.expiredByMs).toBeGreaterThan(0);
    expect(result.expiredByMs!).toBeLessThan(CLUSTER_MODEL_STALE_GRACE_MS);
  });

  it("returns stale at exactly grace period boundary (expiredBy === grace)", () => {
    // At exactly CLUSTER_MODEL_STALE_GRACE_MS expired, model is still in the stale window
    const nowMs = Date.now();
    const expiresAt = new Date(nowMs - CLUSTER_MODEL_STALE_GRACE_MS);
    const builtAt = new Date(expiresAt.getTime() - CLUSTER_MODEL_TTL_MS);
    const model = makeModel({
      builtAt: builtAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const result = evaluateModelStaleness(model, nowMs);

    expect(result.status).toBe("stale");
    expect(result.expiredByMs).toBe(CLUSTER_MODEL_STALE_GRACE_MS);
  });

  it("returns very-stale 1ms beyond grace period", () => {
    const model = makeExpiredModel(CLUSTER_MODEL_STALE_GRACE_MS + 1);
    const nowMs = Date.now();
    const result = evaluateModelStaleness(model, nowMs);

    expect(result.status).toBe("very-stale");
    expect(result.expiredByMs!).toBeGreaterThan(CLUSTER_MODEL_STALE_GRACE_MS);
  });

  it("returns very-stale for a very old model (48h expired)", () => {
    const model = makeExpiredModel(48 * 60 * 60 * 1000);
    const result = evaluateModelStaleness(model);

    expect(result.status).toBe("very-stale");
    expect(result.modelAgeMs).toBeGreaterThan(0);
  });

  it("expiredByMs is 0 for fresh models (not negative)", () => {
    const model = makeModel();
    const result = evaluateModelStaleness(model);
    expect(result.expiredByMs).toBe(0);
  });

  it("modelAgeMs tracks time since builtAt, not expiresAt", () => {
    const nowMs = Date.now();
    const builtAt = new Date(nowMs - 2 * 60 * 60 * 1000); // built 2h ago
    const expiresAt = new Date(nowMs + 22 * 60 * 60 * 1000); // expires in 22h
    const model = makeModel({
      builtAt: builtAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const result = evaluateModelStaleness(model, nowMs);

    // ~2 hours in ms, allow some slack for test execution time
    expect(result.modelAgeMs!).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 100);
    expect(result.modelAgeMs!).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 1000);
  });
});

// ── resolveModelForScoring ────────────────────────────────────────────

describe("resolveModelForScoring", () => {
  it("returns fresh model and emits info log", async () => {
    const model = makeModel();
    const store = makeStore(model);
    const { logger, infoCalls, warnCalls } = createMockLogger();

    const result = await resolveModelForScoring("test/repo", store, logger);

    expect(result.model).toBe(model);
    expect(result.staleness.status).toBe("fresh");
    expect(infoCalls.length).toBe(1);
    const binding = infoCalls[0]!.args[0] as Record<string, unknown>;
    expect(binding.repo).toBe("test/repo");
    expect(binding.modelAgeMs).toBeGreaterThanOrEqual(0);
    expect(warnCalls.length).toBe(0);
  });

  it("returns stale model and emits warn log with staleUse flag", async () => {
    const model = makeExpiredModel(60_000); // expired 1 minute ago
    const store = makeStore(model);
    const { logger, warnCalls } = createMockLogger();

    const result = await resolveModelForScoring("test/repo", store, logger);

    expect(result.model).toBe(model);
    expect(result.staleness.status).toBe("stale");
    expect(warnCalls.length).toBe(1);
    const binding = warnCalls[0]!.args[0] as Record<string, unknown>;
    expect(binding.staleUse).toBe(true);
    expect(binding.expiredByMs).toBeGreaterThan(0);
    expect(binding.gracePeriodMs).toBe(CLUSTER_MODEL_STALE_GRACE_MS);
  });

  it("returns null for very-stale model and emits warn log with noModelFallback", async () => {
    const model = makeExpiredModel(CLUSTER_MODEL_STALE_GRACE_MS + 10_000);
    const store = makeStore(model);
    const { logger, warnCalls } = createMockLogger();

    const result = await resolveModelForScoring("test/repo", store, logger);

    expect(result.model).toBeNull();
    expect(result.staleness.status).toBe("very-stale");
    expect(warnCalls.length).toBe(1);
    const binding = warnCalls[0]!.args[0] as Record<string, unknown>;
    expect(binding.noModelFallback).toBe(true);
  });

  it("returns null for missing model and emits debug log with noModelFallback", async () => {
    const store = makeStore(null);
    const { logger, debugCalls, infoCalls, warnCalls } = createMockLogger();

    const result = await resolveModelForScoring("no/model/repo", store, logger);

    expect(result.model).toBeNull();
    expect(result.staleness.status).toBe("missing");
    expect(debugCalls.length).toBe(1);
    const binding = debugCalls[0]!.args[0] as Record<string, unknown>;
    expect(binding.noModelFallback).toBe(true);
    expect(infoCalls.length).toBe(0);
    expect(warnCalls.length).toBe(0);
  });

  it("degrades to no-scoring (fail-open) when store throws", async () => {
    const store = makeStore("throw");
    const { logger, warnCalls } = createMockLogger();

    const result = await resolveModelForScoring("err/repo", store, logger);

    expect(result.model).toBeNull();
    expect(result.staleness.status).toBe("missing");
    expect(warnCalls.length).toBe(1);
    const msg = warnCalls[0]!.args[1] as string;
    expect(msg).toContain("fail-open");
  });

  it("uses getModelIncludingStale (not getModel) to expose stale rows", async () => {
    const model = makeExpiredModel(60_000);
    const store = makeStore(model);
    const { logger } = createMockLogger();

    await resolveModelForScoring("test/repo", store, logger);

    expect(store.getModelIncludingStale).toHaveBeenCalledWith("test/repo");
    // getModel (strict, hides stale rows) must NOT be called
    expect(store.getModel).not.toHaveBeenCalled();
  });

  it("nowMs override controls staleness classification", async () => {
    // Build a fresh model, but pass nowMs far in the future so it's very-stale
    const model = makeModel();
    const store = makeStore(model);
    const { logger } = createMockLogger();

    // 48h past the model's expiresAt
    const futureNow = new Date(model.expiresAt).getTime() + 48 * 60 * 60 * 1000;
    const result = await resolveModelForScoring("test/repo", store, logger, futureNow);

    expect(result.model).toBeNull();
    expect(result.staleness.status).toBe("very-stale");
  });
});

// ── formatStalenessDescription ────────────────────────────────────────

describe("formatStalenessDescription", () => {
  it("formats missing result", () => {
    const result: ModelStalenessResult = { status: "missing", modelAgeMs: null, expiredByMs: null };
    expect(formatStalenessDescription(result)).toBe("missing (no model row)");
  });

  it("formats fresh result with age", () => {
    const result: ModelStalenessResult = { status: "fresh", modelAgeMs: 60_000, expiredByMs: 0 };
    const desc = formatStalenessDescription(result);
    expect(desc).toContain("fresh");
    expect(desc).toContain("1.0min");
  });

  it("formats stale result with age and expired-by", () => {
    const result: ModelStalenessResult = {
      status: "stale",
      modelAgeMs: 90 * 60 * 1000,     // 90 min
      expiredByMs: 30 * 60 * 1000,    // 30 min past expiry
    };
    const desc = formatStalenessDescription(result);
    expect(desc).toContain("stale");
    expect(desc).toContain("90.0min");
    expect(desc).toContain("30.0min");
  });

  it("formats very-stale result with grace-period note", () => {
    const result: ModelStalenessResult = {
      status: "very-stale",
      modelAgeMs: 30 * 60 * 60 * 1000, // 30h
      expiredByMs: 6 * 60 * 60 * 1000, // 6h past expiry
    };
    const desc = formatStalenessDescription(result);
    expect(desc).toContain("very-stale");
    expect(desc).toContain("grace period");
  });
});

// ── Constant checks ───────────────────────────────────────────────────

describe("constants", () => {
  it("CLUSTER_MODEL_STALE_GRACE_MS is 4 hours", () => {
    expect(CLUSTER_MODEL_STALE_GRACE_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("CLUSTER_MODEL_TTL_MS is 24 hours", () => {
    expect(CLUSTER_MODEL_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("grace period is less than TTL (sanity check)", () => {
    expect(CLUSTER_MODEL_STALE_GRACE_MS).toBeLessThan(CLUSTER_MODEL_TTL_MS);
  });
});
