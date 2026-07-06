import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { DEFAULT_EMPTY_INTENT, type ParsedPRIntent } from "../lib/pr-intent-parser.ts";
import { resolveReviewPrIntent } from "./review-pr-intent.ts";

function createLogger() {
  const info = mock((_bindings: Record<string, unknown>, _message: string) => {});
  const warn = mock((_bindings: Record<string, unknown>, _message: string) => {});
  return {
    logger: { info, warn } as unknown as Pick<Logger, "info" | "warn">,
    info,
    warn,
  };
}

describe("resolveReviewPrIntent", () => {
  test("fetches commit messages, parses PR intent, and logs bounded keyword evidence", async () => {
    const { logger, info, warn } = createLogger();
    const parsedIntent: ParsedPRIntent = {
      ...DEFAULT_EMPTY_INTENT,
      recognized: ["strict-review"],
      unrecognized: ["custom-tag"],
      noReview: false,
      isWIP: true,
      profileOverride: "strict",
      breakingChangeDetected: true,
      conventionalType: { type: "feat", isBreaking: false, source: "title" },
    };
    const fetchCommitMessages = mock(async () => [
      { sha: "abc1234", message: "feat: add playback" },
      { sha: "def5678", message: "fix: cover regression" },
    ]);
    const parseIntent = mock(() => parsedIntent);

    const result = await resolveReviewPrIntent({
      octokit: { rest: { pulls: { listCommits: async () => ({ data: [] }) } } } as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitCount: 2,
      prTitle: "feat: add playback [strict-review]",
      prBody: null,
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      logger,
      fetchCommitMessages,
      parseIntent,
    });

    expect(fetchCommitMessages).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      42,
      2,
    );
    expect(parseIntent).toHaveBeenCalledWith(
      "feat: add playback [strict-review]",
      null,
      [
        { sha: "abc1234", message: "feat: add playback" },
        { sha: "def5678", message: "fix: cover regression" },
      ],
    );
    expect(result).toEqual({
      parsedIntent,
      commitMessagesForLinking: ["feat: add playback", "fix: cover regression"],
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-1",
      prNumber: 42,
      gate: "keyword-parse",
      recognized: ["strict-review"],
      unrecognized: ["custom-tag"],
      noReview: false,
      isWIP: true,
      profileOverride: "strict",
      breakingChange: true,
      conventionalType: "feat",
    });
    expect(info.mock.calls[0]?.[1]).toBe("PR intent keywords parsed");
    expect(warn).not.toHaveBeenCalled();
  });

  test("keeps PR intent parsing fail-open when fetching or parsing fails", async () => {
    const { logger, info, warn } = createLogger();
    const err = new Error("commit fetch failed");

    const result = await resolveReviewPrIntent({
      octokit: {} as never,
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      commitCount: 2,
      prTitle: "feat: add playback",
      prBody: "body",
      baseLog: { deliveryId: "delivery-1", prNumber: 42 },
      logger,
      fetchCommitMessages: mock(async () => {
        throw err;
      }),
    });

    expect(result).toEqual({
      parsedIntent: DEFAULT_EMPTY_INTENT,
      commitMessagesForLinking: [],
    });
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-1",
      prNumber: 42,
      err,
    });
    expect(warn.mock.calls[0]?.[1]).toBe(
      "PR intent parsing failed (fail-open, proceeding without keywords)",
    );
  });
});
