import { describe, expect, test } from "bun:test";
import {
  buildSlackWriteCommitMessage,
  deriveCommitPrefix,
  summarizeSlackWriteRequest,
  summarizeWriteRequest,
} from "./write-request-formatting.ts";

describe("write request formatting", () => {
  test("mention summaries strip polite preambles", () => {
    expect(summarizeWriteRequest("Can you please fix the handler?")).toBe("fix the handler");
  });

  test("Slack summaries preserve request wording", () => {
    expect(summarizeSlackWriteRequest("Please fix the handler?")).toBe("Please fix the handler");
  });

  test("commit prefix derivation uses content before fallback", () => {
    expect(deriveCommitPrefix("refactor the handler", "feat")).toBe("refactor");
    expect(deriveCommitPrefix("document the handler", "chore")).toBe("chore");
  });

  test("builds Slack write commit messages in one canonical format", () => {
    expect(buildSlackWriteCommitMessage({
      request: "please fix the handler?",
      channel: "C123",
      threadTs: "1700000000.000111",
    })).toBe([
      "fix: please fix the handler",
      "",
      "source: slack channel C123 thread 1700000000.000111",
      "request: please fix the handler",
    ].join("\n"));
  });
});
