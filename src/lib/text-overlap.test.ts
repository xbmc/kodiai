import { describe, expect, test } from "bun:test";
import { countWordsInTextBySubstring } from "./text-overlap.ts";

describe("countWordsInTextBySubstring", () => {
  test("counts substring matches instead of requiring exact token equality", () => {
    expect(countWordsInTextBySubstring(["auth", "config"], "authMiddleware reads configuration")).toBe(2);
  });
});
