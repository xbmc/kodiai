import { describe, expect, test } from "bun:test";
import {
  classifyFailures,
  type CheckResult,
  type ClassifiedFailure,
  type FlakinessStat,
} from "./ci-failure-classifier";

describe("classifyFailures", () => {
  // ─── 1. All checks pass ────────────────────────────────────────────────────
  test("returns empty array when all checks pass", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "build", conclusion: "success", status: "completed" },
        { name: "lint", conclusion: "success", status: "completed" },
      ],
      baseResults: new Map(),
      flakiness: new Map(),
    });
    expect(result).toEqual([]);
  });

  // ─── 2. Base-branch match → unrelated, high confidence ────────────────────
  test("classifies as unrelated when same check fails on base branch", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "build", conclusion: "failure", status: "completed" },
      ],
      baseResults: new Map([
        [
          "abc1234567",
          [{ name: "build", conclusion: "failure", status: "completed" }],
        ],
      ]),
      flakiness: new Map(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.checkName).toBe("build");
    expect(result[0]!.classification).toBe("unrelated");
    expect(result[0]!.confidence).toBe("high");
    expect(result[0]!.evidence).toContain("abc1234");
  });

  // ─── 3. Flaky override → flaky-unrelated, medium confidence ───────────────
  test("classifies as flaky-unrelated when flakiness rate exceeds 30% over 20 runs", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "flaky-lint", conclusion: "failure", status: "completed" },
      ],
      baseResults: new Map([
        [
          "base123",
          [{ name: "flaky-lint", conclusion: "success", status: "completed" }],
        ],
      ]),
      flakiness: new Map<string, FlakinessStat>([
        ["flaky-lint", { failures: 8, total: 20 }],
      ]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.checkName).toBe("flaky-lint");
    expect(result[0]!.classification).toBe("flaky-unrelated");
    expect(result[0]!.confidence).toBe("medium");
    expect(result[0]!.flakiness).toBeDefined();
    expect(result[0]!.flakiness!.failRate).toBeCloseTo(0.4);
    expect(result[0]!.flakiness!.window).toBe(20);
  });

  // ─── 4. PR-related default ────────────────────────────────────────────────
  test("classifies as possibly-pr-related when passes on base and no flakiness", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "test-suite", conclusion: "failure", status: "completed" },
      ],
      baseResults: new Map([
        [
          "base123",
          [{ name: "test-suite", conclusion: "success", status: "completed" }],
        ],
      ]),
      flakiness: new Map(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.checkName).toBe("test-suite");
    expect(result[0]!.classification).toBe("possibly-pr-related");
    expect(result[0]!.confidence).toBe("low");
  });

  // ─── 5. Mixed scenario ────────────────────────────────────────────────────
  test("classifies mixed failures correctly", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "build", conclusion: "failure", status: "completed" },
        { name: "flaky-lint", conclusion: "failure", status: "completed" },
        { name: "test-suite", conclusion: "failure", status: "completed" },
        { name: "deploy", conclusion: "success", status: "completed" },
      ],
      baseResults: new Map([
        [
          "base-sha-1",
          [
            { name: "build", conclusion: "failure", status: "completed" },
            { name: "flaky-lint", conclusion: "success", status: "completed" },
            { name: "test-suite", conclusion: "success", status: "completed" },
          ],
        ],
      ]),
      flakiness: new Map<string, FlakinessStat>([
        ["flaky-lint", { failures: 7, total: 20 }],
      ]),
    });

    expect(result).toHaveLength(3);

    const buildResult = result.find((r) => r.checkName === "build")!;
    expect(buildResult.classification).toBe("unrelated");
    expect(buildResult.confidence).toBe("high");

    const flakyResult = result.find((r) => r.checkName === "flaky-lint")!;
    expect(flakyResult.classification).toBe("flaky-unrelated");
    expect(flakyResult.confidence).toBe("medium");

    const testResult = result.find((r) => r.checkName === "test-suite")!;
    expect(testResult.classification).toBe("possibly-pr-related");
    expect(testResult.confidence).toBe("low");
  });

  // ─── 6. Flaky below threshold ─────────────────────────────────────────────
  test("does not classify as flaky when rate is below 30%", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "check-a", conclusion: "failure", status: "completed" },
      ],
      baseResults: new Map([
        [
          "base123",
          [{ name: "check-a", conclusion: "success", status: "completed" }],
        ],
      ]),
      flakiness: new Map<string, FlakinessStat>([
        ["check-a", { failures: 5, total: 20 }],
      ]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.classification).toBe("possibly-pr-related");
    expect(result[0]!.confidence).toBe("low");
  });

  // ─── 7. Flaky insufficient data ───────────────────────────────────────────
  test("does not classify as flaky when total runs < 20", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "check-b", conclusion: "failure", status: "completed" },
      ],
      baseResults: new Map([
        [
          "base123",
          [{ name: "check-b", conclusion: "success", status: "completed" }],
        ],
      ]),
      flakiness: new Map<string, FlakinessStat>([
        ["check-b", { failures: 3, total: 10 }],
      ]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.classification).toBe("possibly-pr-related");
    expect(result[0]!.confidence).toBe("low");
  });

  // ─── 8. No base results at all ────────────────────────────────────────────
  test("classifies all failures as possibly-pr-related when no base results exist", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "build", conclusion: "failure", status: "completed" },
        { name: "lint", conclusion: "failure", status: "completed" },
      ],
      baseResults: new Map(),
      flakiness: new Map(),
    });

    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.classification).toBe("possibly-pr-related");
      expect(r.confidence).toBe("low");
    }
  });

  // ─── Additional: null conclusion is not treated as failure ─────────────────
  test("ignores checks with null conclusion", () => {
    const result = classifyFailures({
      headChecks: [
        { name: "pending-check", conclusion: null, status: "in_progress" },
        { name: "build", conclusion: "success", status: "completed" },
      ],
      baseResults: new Map(),
      flakiness: new Map(),
    });
    expect(result).toEqual([]);
  });
});
