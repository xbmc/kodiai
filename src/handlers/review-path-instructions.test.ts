import { describe, expect, test } from "bun:test";
import type { MatchedInstruction, PathInstruction } from "../execution/review-prompt.ts";
import { resolveReviewPathInstructions } from "./review-path-instructions.ts";

describe("resolveReviewPathInstructions", () => {
  test("skips matching when no path instructions are configured", () => {
    let called = false;

    const result = resolveReviewPathInstructions({
      pathInstructions: [],
      changedFiles: ["src/api/users.ts"],
      matchPathInstructionsFn: () => {
        called = true;
        return [];
      },
    });

    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  test("matches configured path instructions against changed files", () => {
    const pathInstructions: PathInstruction[] = [
      {
        path: "src/api/**",
        instructions: "Review API auth checks.",
      },
    ];
    const expected: MatchedInstruction[] = [
      {
        pattern: "src/api/**",
        instructions: "Review API auth checks.",
        matchedFiles: ["src/api/users.ts"],
      },
    ];

    const result = resolveReviewPathInstructions({
      pathInstructions,
      changedFiles: ["src/api/users.ts", "README.md"],
      matchPathInstructionsFn: (configuredInstructions, changedFiles) => {
        expect(configuredInstructions).toEqual(pathInstructions);
        expect(changedFiles).toEqual(["src/api/users.ts", "README.md"]);
        return expected;
      },
    });

    expect(result).toEqual(expected);
  });
});
