import { describe, expect, test } from "bun:test";
import { evaluateM042S01 } from "./verify-m042-s01.ts";

describe("evaluateM042S01", () => {
  test("passes all slice proof checks", async () => {
    const result = await evaluateM042S01();

    expect(result.milestone).toBe("M042");
    expect(result.slice).toBe("S01");
    expect(result.overallPassed).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.map((check) => check.id)).toEqual([
      "M042-S01-STUCK-TIER-REPRO-FIXED",
      "M042-S01-RECALCULATED-TIER-PERSISTS",
      "M042-S01-PROFILE-PRECEDENCE",
      "M042-S01-FAIL-OPEN-NONBLOCKING",
    ]);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });
});
