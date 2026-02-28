import { describe, it, expect } from "bun:test";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import {
  classifyOutcome,
  posteriorMean,
  posteriorToThreshold,
  recordObservation,
  getEffectiveThreshold,
} from "./threshold-learner.ts";

// ── Test helpers ──────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    warn: () => {},
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as Logger;
}

function createTrackingSql(
  returnValues: any[][] = [[]],
): { sql: Sql; calls: Array<{ strings: string[]; values: unknown[] }> } {
  const calls: Array<{ strings: string[]; values: unknown[] }> = [];
  let callIndex = 0;
  const fn = (...args: any[]) => {
    if (Array.isArray(args[0])) {
      calls.push({ strings: Array.from(args[0]), values: args.slice(1) });
    }
    const result = returnValues[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(result);
  };
  const sql = new Proxy(fn, {
    apply: (_target, _thisArg, args) => fn(...args),
  }) as unknown as Sql;
  return { sql, calls };
}

// ── Pure function tests ───────────────────────────────────────────────────

describe("classifyOutcome", () => {
  it("TP -- predicted=true, confirmed=true", () => {
    const result = classifyOutcome(true, true);
    expect(result).toEqual({ correct: true, quadrant: "TP" });
  });

  it("FP -- predicted=true, confirmed=false", () => {
    const result = classifyOutcome(true, false);
    expect(result).toEqual({ correct: false, quadrant: "FP" });
  });

  it("FN -- predicted=false, confirmed=true", () => {
    const result = classifyOutcome(false, true);
    expect(result).toEqual({ correct: false, quadrant: "FN" });
  });

  it("TN -- predicted=false, confirmed=false", () => {
    const result = classifyOutcome(false, false);
    expect(result).toEqual({ correct: true, quadrant: "TN" });
  });
});

describe("posteriorMean", () => {
  it("uniform prior returns 0.5", () => {
    expect(posteriorMean(1, 1)).toBe(0.5);
  });

  it("strong alpha returns ~0.833", () => {
    expect(posteriorMean(10, 2)).toBeCloseTo(0.833, 2);
  });
});

describe("posteriorToThreshold", () => {
  it("uniform prior returns floor (50)", () => {
    // mean = 0.5, raw = round(100 * 0.5) = 50, clamp [50,95] = 50
    expect(posteriorToThreshold(1, 1, 50, 95)).toBe(50);
  });

  it("high accuracy lowers threshold toward floor", () => {
    // mean = 20/22 = 0.909, raw = round(100 * 0.091) = round(9.09) = 9, clamped to 50
    const result = posteriorToThreshold(20, 2, 50, 95);
    expect(result).toBe(50);
  });

  it("low accuracy raises threshold toward ceiling", () => {
    // mean = 2/22 = 0.0909, raw = round(100 * 0.909) = round(90.9) = 91, clamped [50,95] = 91
    const result = posteriorToThreshold(2, 20, 50, 95);
    expect(result).toBe(91);
  });

  it("clamps above ceiling", () => {
    // mean = 1/101 = 0.0099, raw = round(100 * 0.990) = round(99.0) = 99, clamped to 95
    expect(posteriorToThreshold(1, 100, 50, 95)).toBe(95);
  });

  it("clamps below floor", () => {
    // mean = 100/101 = 0.990, raw = round(100 * 0.0099) = round(0.99) = 1, clamped to 50
    expect(posteriorToThreshold(100, 1, 50, 95)).toBe(50);
  });
});

// ── DB-boundary function tests ────────────────────────────────────────────

describe("recordObservation", () => {
  it("skips TN (no signal)", async () => {
    const { sql, calls } = createTrackingSql();
    await recordObservation({
      sql,
      repo: "owner/repo",
      kodiaiPredictedDuplicate: false,
      confirmedDuplicate: false,
      logger: createMockLogger(),
    });
    expect(calls).toHaveLength(0);
  });

  it("TP increments alpha atomically", async () => {
    const { sql, calls } = createTrackingSql();
    await recordObservation({
      sql,
      repo: "owner/repo",
      kodiaiPredictedDuplicate: true,
      confirmedDuplicate: true,
      logger: createMockLogger(),
    });
    expect(calls).toHaveLength(1);
    const joined = calls[0].strings.join(" ");
    expect(joined).toContain("triage_threshold_state");
    expect(joined).toContain("ON CONFLICT");
    // TP: alphaInc=1, betaInc=0
    // Values: repo, 1.0+1=2.0, 1.0+0=1.0, alphaInc=1, betaInc=0
    expect(calls[0].values).toContain(1); // alphaInc
    expect(calls[0].values).toContain(0); // betaInc
  });

  it("FP increments beta atomically", async () => {
    const { sql, calls } = createTrackingSql();
    await recordObservation({
      sql,
      repo: "owner/repo",
      kodiaiPredictedDuplicate: true,
      confirmedDuplicate: false,
      logger: createMockLogger(),
    });
    expect(calls).toHaveLength(1);
    // FP: alphaInc=0, betaInc=1
    expect(calls[0].values).toContain(0); // alphaInc
    expect(calls[0].values).toContain(1); // betaInc
  });

  it("FN increments beta atomically", async () => {
    const { sql, calls } = createTrackingSql();
    await recordObservation({
      sql,
      repo: "owner/repo",
      kodiaiPredictedDuplicate: false,
      confirmedDuplicate: true,
      logger: createMockLogger(),
    });
    expect(calls).toHaveLength(1);
    // FN: alphaInc=0, betaInc=1
    expect(calls[0].values).toContain(1); // betaInc
  });
});

describe("getEffectiveThreshold", () => {
  it("returns config fallback when no rows", async () => {
    const { sql } = createTrackingSql([[]]);
    const result = await getEffectiveThreshold({
      sql,
      repo: "owner/repo",
      configThreshold: 75,
      logger: createMockLogger(),
    });
    expect(result).toEqual({ threshold: 75, source: "config" });
  });

  it("returns config fallback when sample_count < minSamples", async () => {
    const { sql } = createTrackingSql([
      [{ alpha: 15, beta_: 3, sample_count: 10 }],
    ]);
    const result = await getEffectiveThreshold({
      sql,
      repo: "owner/repo",
      configThreshold: 75,
      logger: createMockLogger(),
    });
    expect(result).toEqual({ threshold: 75, source: "config" });
  });

  it("returns learned threshold when sample_count >= 20", async () => {
    const { sql } = createTrackingSql([
      [{ alpha: 18, beta_: 4, sample_count: 25 }],
    ]);
    const result = await getEffectiveThreshold({
      sql,
      repo: "owner/repo",
      configThreshold: 75,
      logger: createMockLogger(),
    });
    // mean = 18/22 = 0.818, raw = round(100 * 0.182) = round(18.18) = 18, clamped to 50
    expect(result).toEqual({
      threshold: 50,
      source: "learned",
      alpha: 18,
      beta: 4,
      sampleCount: 25,
    });
  });

  it("returns clamped threshold at ceiling", async () => {
    const { sql } = createTrackingSql([
      [{ alpha: 2, beta_: 20, sample_count: 21 }],
    ]);
    const result = await getEffectiveThreshold({
      sql,
      repo: "owner/repo",
      configThreshold: 75,
      logger: createMockLogger(),
    });
    // mean = 2/22 = 0.0909, raw = round(100 * 0.909) = round(90.9) = 91
    expect(result.threshold).toBe(91);
    expect(result.source).toBe("learned");
  });

  it("exact boundary at minSamples=20 uses learned", async () => {
    const { sql } = createTrackingSql([
      [{ alpha: 10, beta_: 10, sample_count: 20 }],
    ]);
    const result = await getEffectiveThreshold({
      sql,
      repo: "owner/repo",
      configThreshold: 75,
      logger: createMockLogger(),
    });
    expect(result.source).toBe("learned");
  });
});
