import { describe, test, expect } from "bun:test";
import {
  computeAdaptiveThreshold,
  DEFAULT_ADAPTIVE_CONFIG,
  type AdaptiveThresholdConfig,
} from "./adaptive-threshold.ts";

describe("computeAdaptiveThreshold", () => {
  test("empty distances returns configured threshold (method=configured)", () => {
    const result = computeAdaptiveThreshold({
      distances: [],
      configuredThreshold: 0.3,
    });

    expect(result).toEqual({
      threshold: 0.3,
      method: "configured",
      candidateCount: 0,
    });
  });

  test("single distance uses percentile fallback", () => {
    const result = computeAdaptiveThreshold({
      distances: [0.2],
      configuredThreshold: 0.3,
    });

    expect(result.method).toBe("percentile");
    expect(result.threshold).toBe(0.2);
    expect(result.candidateCount).toBe(1);
  });

  test("7 candidates uses percentile fallback", () => {
    const distances = [0.1, 0.15, 0.18, 0.2, 0.22, 0.25, 0.28];
    const result = computeAdaptiveThreshold({
      distances,
      configuredThreshold: 0.3,
    });

    // idx = floor(7 * 0.75) = 5 -> distances[5] = 0.25
    expect(result).toEqual({
      threshold: 0.25,
      method: "percentile",
      candidateCount: 7,
    });
  });

  test("8 candidates uses max-gap detection when a clear gap exists", () => {
    const distances = [0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.5];
    const result = computeAdaptiveThreshold({
      distances,
      configuredThreshold: 0.3,
    });

    expect(result.method).toBe("adaptive");
    expect(result.threshold).toBe(0.25);
    expect(result.candidateCount).toBe(8);
    expect(result.gapSize).toBeCloseTo(0.25);
    expect(result.gapIndex).toBe(7);
  });

  test("max-gap below minimum gap size falls back to configured threshold", () => {
    const result = computeAdaptiveThreshold({
      distances: [0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35],
      configuredThreshold: 0.3,
    });

    expect(result.method).toBe("configured");
    expect(result.threshold).toBe(0.3);
    expect(result.candidateCount).toBe(8);
    expect(result.gapSize).toBeLessThan(DEFAULT_ADAPTIVE_CONFIG.minGapSize);
  });

  test("threshold is clamped to floor", () => {
    const result = computeAdaptiveThreshold({
      distances: [0.05, 0.06],
      configuredThreshold: 0.3,
    });

    expect(result.method).toBe("percentile");
    expect(result.threshold).toBe(DEFAULT_ADAPTIVE_CONFIG.floor);
  });

  test("threshold is clamped to ceiling", () => {
    const result = computeAdaptiveThreshold({
      distances: [0.7, 0.8, 0.9],
      configuredThreshold: 0.3,
    });

    expect(result.method).toBe("percentile");
    expect(result.threshold).toBe(DEFAULT_ADAPTIVE_CONFIG.ceiling);
  });

  test("unsorted input yields same result as sorted input", () => {
    const sorted = [0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.5];
    const unsorted = [0.2, 0.5, 0.1, 0.12, 0.25, 0.18, 0.15, 0.22];

    const a = computeAdaptiveThreshold({
      distances: sorted,
      configuredThreshold: 0.3,
    });
    const b = computeAdaptiveThreshold({
      distances: unsorted,
      configuredThreshold: 0.3,
    });

    expect(a).toEqual(b);
  });

  test("config override: percentile and bounds are honored", () => {
    const config: AdaptiveThresholdConfig = {
      ...DEFAULT_ADAPTIVE_CONFIG,
      fallbackPercentile: 0.5,
      floor: 0.1,
      ceiling: 0.2,
    };

    const result = computeAdaptiveThreshold({
      distances: [0.12, 0.25, 0.3, 0.35],
      configuredThreshold: 0.3,
      config,
    });

    // idx = floor(4 * 0.5) = 2 -> 0.3 clamped to 0.2
    expect(result.method).toBe("percentile");
    expect(result.threshold).toBe(0.2);
  });
});
