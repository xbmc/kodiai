import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { evaluateReviewSkipAuthorGate } from "./review-skip-author-gate.ts";

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

describe("evaluateReviewSkipAuthorGate", () => {
  test("continues when the PR author is not configured to skip", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewSkipAuthorGate({
      prNumber: 42,
      authorLogin: "alice",
      skipAuthors: ["dependabot[bot]"],
      logger,
    });

    expect(decision).toEqual({ action: "continue" });
    expect(entries).toEqual([]);
  });

  test("skips and logs when the PR author is configured to skip", () => {
    const { logger, entries } = makeLogger();

    const decision = evaluateReviewSkipAuthorGate({
      prNumber: 42,
      authorLogin: "dependabot[bot]",
      skipAuthors: ["renovate[bot]", "dependabot[bot]"],
      logger,
    });

    expect(decision).toEqual({ action: "skip" });
    expect(entries).toEqual([
      {
        data: { prNumber: 42, author: "dependabot[bot]" },
        message: "PR author in skipAuthors, skipping review",
      },
    ]);
  });
});
