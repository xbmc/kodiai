import { describe, expect, test } from "bun:test";
import {
  computeLanguageComplexity,
  estimateTimeoutRisk,
  type TimeoutEstimate,
} from "./timeout-estimator.ts";

// ---------- computeLanguageComplexity ----------

describe("computeLanguageComplexity", () => {
  test("empty filesByLanguage returns default 0.3", () => {
    expect(computeLanguageComplexity({})).toBe(0.3);
  });

  test("pure TypeScript files return 0.4", () => {
    const result = computeLanguageComplexity({
      TypeScript: ["a.ts", "b.ts", "c.ts"],
    });
    expect(result).toBeCloseTo(0.4, 5);
  });

  test("pure C files return 1.0", () => {
    const result = computeLanguageComplexity({
      C: ["main.c", "util.c"],
    });
    expect(result).toBeCloseTo(1.0, 5);
  });

  test("mixed languages compute weighted average", () => {
    // 2 TypeScript (0.4) + 1 C (1.0) => (0.4*2 + 1.0*1) / 3 = 1.8/3 = 0.6
    const result = computeLanguageComplexity({
      TypeScript: ["a.ts", "b.ts"],
      C: ["main.c"],
    });
    expect(result).toBeCloseTo(0.6, 5);
  });

  test("unknown language defaults to 0.3 risk", () => {
    const result = computeLanguageComplexity({
      Haskell: ["Main.hs"],
    });
    expect(result).toBeCloseTo(0.3, 5);
  });

  test("returns value between 0 and 1", () => {
    const result = computeLanguageComplexity({
      "C++": ["a.cpp", "b.cpp", "c.cpp", "d.cpp", "e.cpp"],
    });
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ---------- estimateTimeoutRisk ----------

describe("estimateTimeoutRisk", () => {
  const baseTimeout = 600;

  test("small PR (3 files, 50 lines, TypeScript) => low risk, timeout < base", () => {
    const result = estimateTimeoutRisk({
      fileCount: 3,
      linesChanged: 50,
      languageComplexity: 0.4, // TypeScript
      isLargePR: false,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.riskLevel).toBe("low");
    expect(result.dynamicTimeoutSeconds).toBeLessThan(baseTimeout);
    expect(result.shouldReduceScope).toBe(false);
    expect(result.reducedFileCount).toBeNull();
  });

  test("medium PR (30 files, 800 lines, mixed) => medium risk", () => {
    const result = estimateTimeoutRisk({
      fileCount: 30,
      linesChanged: 800,
      languageComplexity: 0.6, // mixed
      isLargePR: false,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.riskLevel).toBe("medium");
    expect(result.shouldReduceScope).toBe(false);
  });

  test("large PR (80 files, 2000 lines, C/C++) => high risk, scope reduction", () => {
    const result = estimateTimeoutRisk({
      fileCount: 80,
      linesChanged: 2000,
      languageComplexity: 1.0, // C/C++
      isLargePR: true,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.riskLevel).toBe("high");
    expect(result.shouldReduceScope).toBe(true);
    expect(result.reducedFileCount).toBe(50);
    expect(result.dynamicTimeoutSeconds).toBeGreaterThan(baseTimeout);
  });

  test("0 files returns low risk", () => {
    const result = estimateTimeoutRisk({
      fileCount: 0,
      linesChanged: 0,
      languageComplexity: 0.3,
      isLargePR: false,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.riskLevel).toBe("low");
    expect(result.shouldReduceScope).toBe(false);
  });

  test("timeout never below 30 seconds", () => {
    const result = estimateTimeoutRisk({
      fileCount: 1,
      linesChanged: 1,
      languageComplexity: 0.1,
      isLargePR: false,
      baseTimeoutSeconds: 30, // small base
    });

    expect(result.dynamicTimeoutSeconds).toBeGreaterThanOrEqual(30);
  });

  test("timeout never above 1800 seconds", () => {
    const result = estimateTimeoutRisk({
      fileCount: 200,
      linesChanged: 10000,
      languageComplexity: 1.0,
      isLargePR: true,
      baseTimeoutSeconds: 1800, // max base
    });

    expect(result.dynamicTimeoutSeconds).toBeLessThanOrEqual(1800);
  });

  test("dynamic timeout scales proportionally (small < large)", () => {
    const small = estimateTimeoutRisk({
      fileCount: 3,
      linesChanged: 50,
      languageComplexity: 0.4,
      isLargePR: false,
      baseTimeoutSeconds: baseTimeout,
    });

    const large = estimateTimeoutRisk({
      fileCount: 80,
      linesChanged: 2000,
      languageComplexity: 1.0,
      isLargePR: true,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(small.dynamicTimeoutSeconds).toBeLessThan(
      large.dynamicTimeoutSeconds,
    );
  });

  test("reducedFileCount caps at 50 for high-risk PR with more than 50 files", () => {
    const result = estimateTimeoutRisk({
      fileCount: 120,
      linesChanged: 3000,
      languageComplexity: 1.0,
      isLargePR: true,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.shouldReduceScope).toBe(true);
    expect(result.reducedFileCount).toBe(50);
  });

  test("reducedFileCount uses actual file count when less than 50", () => {
    // Need complexity >= 0.6 to get high risk with fewer files
    // fileScore = 45/100 = 0.45, lineScore = 4000/5000 = 0.8, langScore = 1.0
    // complexity = 0.45*0.4 + 0.8*0.4 + 1.0*0.2 = 0.18 + 0.32 + 0.2 = 0.7 => high
    const result = estimateTimeoutRisk({
      fileCount: 45,
      linesChanged: 4000,
      languageComplexity: 1.0,
      isLargePR: true,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.riskLevel).toBe("high");
    expect(result.shouldReduceScope).toBe(true);
    expect(result.reducedFileCount).toBe(45);
  });

  test("reasoning string contains key metrics", () => {
    const result = estimateTimeoutRisk({
      fileCount: 10,
      linesChanged: 200,
      languageComplexity: 0.5,
      isLargePR: false,
      baseTimeoutSeconds: baseTimeout,
    });

    expect(result.reasoning).toContain("files: 10");
    expect(result.reasoning).toContain("lines: 200");
    expect(result.reasoning).toContain("lang risk: 50%");
    expect(result.reasoning).toContain(result.riskLevel);
    expect(result.reasoning).toContain(
      `${result.dynamicTimeoutSeconds}s`,
    );
  });

  test("timeout is always an integer", () => {
    const result = estimateTimeoutRisk({
      fileCount: 17,
      linesChanged: 333,
      languageComplexity: 0.47,
      isLargePR: false,
      baseTimeoutSeconds: 599,
    });

    expect(Number.isInteger(result.dynamicTimeoutSeconds)).toBe(true);
  });
});
