import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FINDING_PRIORITY_WEIGHTS,
  prioritizeFindings,
  scoreFinding,
  type FindingForPrioritization,
} from "./finding-prioritizer.ts";

describe("scoreFinding", () => {
  test("composite score uses severity, file risk, category, and recurrence", () => {
    const higher = scoreFinding({
      finding: {
        filePath: "src/auth/session.ts",
        title: "Token validation can be bypassed",
        severity: "major",
        category: "security",
        fileRiskScore: 90,
        recurrenceCount: 4,
      },
    });

    const lower = scoreFinding({
      finding: {
        filePath: "docs/README.md",
        title: "Sentence casing mismatch",
        severity: "major",
        category: "style",
        fileRiskScore: 10,
        recurrenceCount: 0,
      },
    });

    expect(higher.score).toBeGreaterThan(lower.score);
  });

  test("higher file risk outranks equal-severity lower-risk finding", () => {
    const highRisk = scoreFinding({
      finding: {
        filePath: "src/auth/token.ts",
        title: "Missing nonce validation",
        severity: "medium",
        category: "correctness",
        fileRiskScore: 95,
        recurrenceCount: 0,
      },
    });

    const lowRisk = scoreFinding({
      finding: {
        filePath: "src/ui/button.tsx",
        title: "Missing nonce validation",
        severity: "medium",
        category: "correctness",
        fileRiskScore: 20,
        recurrenceCount: 0,
      },
    });

    expect(highRisk.score).toBeGreaterThan(lowRisk.score);
  });

  test("recurrence boosts score when other factors are close", () => {
    const repeated = scoreFinding({
      finding: {
        filePath: "src/services/cache.ts",
        title: "Resource leak in error path",
        severity: "medium",
        category: "performance",
        fileRiskScore: 55,
        recurrenceCount: 5,
      },
    });

    const oneOff = scoreFinding({
      finding: {
        filePath: "src/services/cache.ts",
        title: "Resource leak in error path",
        severity: "medium",
        category: "performance",
        fileRiskScore: 55,
        recurrenceCount: 0,
      },
    });

    expect(repeated.score).toBeGreaterThan(oneOff.score);
  });

  test("configurable weights change ordering deterministically", () => {
    const findings: FindingForPrioritization[] = [
      {
        filePath: "src/core.ts",
        title: "General regression",
        severity: "major",
        category: "correctness",
        fileRiskScore: 20,
        recurrenceCount: 0,
      },
      {
        filePath: "src/auth.ts",
        title: "Auth-sensitive regression",
        severity: "medium",
        category: "security",
        fileRiskScore: 95,
        recurrenceCount: 0,
      },
    ];

    const defaultOrder = prioritizeFindings({ findings }).selectedFindings;
    expect(defaultOrder[0]?.title).toBe("General regression");

    const riskHeavyOrder = prioritizeFindings({
      findings,
      weights: {
        severity: 0.1,
        fileRisk: 0.7,
        category: 0.15,
        recurrence: 0.05,
      },
    }).selectedFindings;
    expect(riskHeavyOrder[0]?.title).toBe("Auth-sensitive regression");
  });
});

describe("prioritizeFindings", () => {
  test("returns only top maxComments findings when over cap", () => {
    const findings: FindingForPrioritization[] = [
      {
        filePath: "src/a.ts",
        title: "A",
        severity: "critical",
        category: "security",
        fileRiskScore: 95,
        recurrenceCount: 2,
      },
      {
        filePath: "src/b.ts",
        title: "B",
        severity: "major",
        category: "correctness",
        fileRiskScore: 80,
        recurrenceCount: 2,
      },
      {
        filePath: "src/c.ts",
        title: "C",
        severity: "medium",
        category: "correctness",
        fileRiskScore: 70,
        recurrenceCount: 1,
      },
      {
        filePath: "src/d.ts",
        title: "D",
        severity: "minor",
        category: "style",
        fileRiskScore: 15,
        recurrenceCount: 0,
      },
    ];

    const result = prioritizeFindings({ findings, maxComments: 2 });

    expect(result.rankedFindings).toHaveLength(4);
    expect(result.selectedFindings).toHaveLength(2);
    expect(result.selectedFindings[0]?.title).toBe("A");
    expect(result.selectedFindings[1]?.title).toBe("B");
  });

  test("ties keep stable order by original index", () => {
    const findings: FindingForPrioritization[] = [
      {
        filePath: "src/a.ts",
        title: "First",
        severity: "medium",
        category: "correctness",
        fileRiskScore: 50,
        recurrenceCount: 1,
      },
      {
        filePath: "src/b.ts",
        title: "Second",
        severity: "medium",
        category: "correctness",
        fileRiskScore: 50,
        recurrenceCount: 1,
      },
      {
        filePath: "src/c.ts",
        title: "Third",
        severity: "medium",
        category: "correctness",
        fileRiskScore: 50,
        recurrenceCount: 1,
      },
    ];

    const result = prioritizeFindings({ findings, maxComments: 2 });

    expect(result.selectedFindings.map((finding) => finding.title)).toEqual([
      "First",
      "Second",
    ]);
  });

  test("returns findingsScored, topScore, and thresholdScore stats", () => {
    const findings: FindingForPrioritization[] = [
      {
        filePath: "src/high.ts",
        title: "Highest",
        severity: "critical",
        category: "security",
        fileRiskScore: 100,
        recurrenceCount: 5,
      },
      {
        filePath: "src/mid.ts",
        title: "Middle",
        severity: "major",
        category: "correctness",
        fileRiskScore: 60,
        recurrenceCount: 1,
      },
      {
        filePath: "src/low.ts",
        title: "Lower",
        severity: "minor",
        category: "style",
        fileRiskScore: 5,
        recurrenceCount: 0,
      },
    ];

    const result = prioritizeFindings({ findings, maxComments: 2 });

    expect(result.stats.findingsScored).toBe(3);
    expect(result.stats.topScore).toBe(result.rankedFindings[0]?.score ?? null);
    expect(result.stats.thresholdScore).toBe(result.selectedFindings[1]?.score ?? null);
  });

  test("exports stable default weights", () => {
    expect(DEFAULT_FINDING_PRIORITY_WEIGHTS).toEqual({
      severity: 0.45,
      fileRisk: 0.3,
      category: 0.15,
      recurrence: 0.1,
    });
  });
});
