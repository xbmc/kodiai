import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { evaluateReviewSkipPathsGate } from "./review-skip-paths-gate.ts";

function makeLogger() {
  const entries: Array<{ data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ data, message });
      },
    } as unknown as Pick<Logger, "info">,
  };
}

describe("evaluateReviewSkipPathsGate", () => {
  test("returns changed files that do not match skip paths", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewSkipPathsGate({
      prNumber: 42,
      allChangedFiles: ["docs/readme.md", "src/app.ts", "README.md"],
      skipPaths: ["docs/**", "*.md"],
      logger,
    });

    expect(decision).toEqual({
      action: "continue",
      changedFiles: ["src/app.ts"],
    });
    expect(entries).toEqual([]);
  });

  test("skips and logs when all changed files match skip paths", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewSkipPathsGate({
      prNumber: 42,
      allChangedFiles: ["docs/readme.md", "README.md"],
      skipPaths: ["docs/**", "*.md"],
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries).toEqual([
      {
        data: { prNumber: 42, totalFiles: 2 },
        message: "All changed files matched skipPaths, skipping review",
      },
    ]);
  });

  test("ignores empty skip path patterns", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewSkipPathsGate({
      prNumber: 42,
      allChangedFiles: ["src/app.ts"],
      skipPaths: ["", "   "],
      logger,
    });

    expect(decision).toEqual({
      action: "continue",
      changedFiles: ["src/app.ts"],
    });
    expect(entries).toEqual([]);
  });
});
