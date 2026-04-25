import { describe, expect, test } from "bun:test";
import { buildPromptBuildResult } from "./prompt-section-metrics.ts";

describe("buildPromptBuildResult", () => {
  test("accounts for separator characters in per-section char counts", () => {
    const result = buildPromptBuildResult([
      { sectionName: "a", text: "alpha" },
      { sectionName: "b", text: "beta" },
    ], "\n\n");

    expect(result.text).toBe("alpha\n\nbeta");
    expect(result.sections.map((section) => section.charCount)).toEqual([7, 4]);
    expect(result.sections.reduce((sum, section) => sum + section.charCount, 0)).toBe(result.text.length);
  });
});
