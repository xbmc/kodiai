import { describe, expect, mock, test } from "bun:test";
import { logMentionProcessing } from "./mention-processing-log.ts";

describe("logMentionProcessing", () => {
  test("logs normalized mention context fields", () => {
    const logger = { info: mock(() => {}) };

    logMentionProcessing({
      logger,
      mention: {
        surface: "pr_comment",
        owner: "owner",
        repo: "repo",
        issueNumber: 12,
        prNumber: 12,
        commentAuthor: "octocat",
      },
      acceptClaudeAlias: true,
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        surface: "pr_comment",
        owner: "owner",
        repo: "repo",
        issueNumber: 12,
        prNumber: 12,
        commentAuthor: "octocat",
        acceptClaudeAlias: true,
      },
      "Processing mention",
    );
  });
});
