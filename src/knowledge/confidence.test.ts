import { describe, expect, test } from "bun:test";
import {
  computeConfidence,
  matchPattern,
  matchesSuppression,
  type SuppressionPattern,
} from "./confidence.ts";

describe("computeConfidence", () => {
  test("caps score at 100 for strong security signals", () => {
    const score = computeConfidence({
      severity: "critical",
      category: "security",
      matchesKnownPattern: true,
    });
    expect(score).toBe(100);
  });

  test("returns expected score for major correctness", () => {
    const score = computeConfidence({
      severity: "major",
      category: "correctness",
      matchesKnownPattern: false,
    });
    expect(score).toBe(80);
  });

  test("returns expected score for minor style", () => {
    const score = computeConfidence({
      severity: "minor",
      category: "style",
      matchesKnownPattern: false,
    });
    expect(score).toBe(45);
  });

  test("returns expected score for minor documentation", () => {
    const score = computeConfidence({
      severity: "minor",
      category: "documentation",
      matchesKnownPattern: false,
    });
    expect(score).toBe(40);
  });
});

describe("matchPattern", () => {
  test("matches substring case-insensitively", () => {
    expect(matchPattern("missing error handling", "Missing Error Handling in auth flow")).toBe(true);
  });

  test("matches glob prefixed patterns", () => {
    expect(matchPattern("glob:*unused*", "unused import detected")).toBe(true);
  });

  test("matches regex prefixed patterns", () => {
    expect(matchPattern("regex:missing.*handling", "missing null handling in parser")).toBe(true);
  });

  test("returns false for invalid regex patterns", () => {
    expect(matchPattern("regex:[invalid", "anything")).toBe(false);
  });
});

describe("matchesSuppression", () => {
  const finding = {
    title: "Missing error handling around API call",
    severity: "major" as const,
    category: "correctness" as const,
    filePath: "src/api/client.ts",
  };

  test("matches simple string suppression", () => {
    expect(matchesSuppression(finding, "missing error handling")).toBe(true);
  });

  test("applies severity filter", () => {
    const suppression: SuppressionPattern = {
      pattern: "missing error handling",
      severity: ["minor"],
    };
    expect(matchesSuppression(finding, suppression)).toBe(false);
  });

  test("applies category filter", () => {
    const suppression: SuppressionPattern = {
      pattern: "missing error handling",
      category: ["security"],
    };
    expect(matchesSuppression(finding, suppression)).toBe(false);
  });

  test("applies path filters with glob", () => {
    const suppression: SuppressionPattern = {
      pattern: "missing error handling",
      paths: ["src/api/**"],
    };
    expect(matchesSuppression(finding, suppression)).toBe(true);
  });

  test("requires all filters to pass", () => {
    const suppression: SuppressionPattern = {
      pattern: "missing error handling",
      severity: ["major"],
      category: ["correctness"],
      paths: ["src/**"],
    };
    expect(matchesSuppression(finding, suppression)).toBe(true);
  });
});
