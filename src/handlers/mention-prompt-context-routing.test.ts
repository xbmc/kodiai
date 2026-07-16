import { describe, expect, test } from "bun:test";
import { resolveMentionPromptContextRouting } from "./mention-prompt-context-routing.ts";

describe("resolveMentionPromptContextRouting", () => {
  test("grounds review-intent PR mentions in PR diff context and suppresses issue corpus", () => {
    const routing = resolveMentionPromptContextRouting({
      isIssueThreadComment: false,
      prNumber: 42,
      writeRequest: "please review",
    });

    expect(routing).toEqual({
      allowIssueCodePointers: false,
      allowPrDiffContext: true,
      includeIssueCorpus: false,
    });
  });

  test("does not run PR diff context for vague non-technical chatter", () => {
    const routing = resolveMentionPromptContextRouting({
      isIssueThreadComment: false,
      prNumber: 28497,
      writeRequest: "how do you repent?",
    });

    expect(routing).toEqual({
      allowIssueCodePointers: false,
      allowPrDiffContext: false,
      includeIssueCorpus: false,
    });
  });

  test("allows issue code pointers for code-seeking issue mentions", () => {
    const routing = resolveMentionPromptContextRouting({
      isIssueThreadComment: true,
      prNumber: undefined,
      writeRequest: "where is the handler in src/handlers/review.ts",
    });

    expect(routing).toEqual({
      allowIssueCodePointers: true,
      allowPrDiffContext: false,
      includeIssueCorpus: true,
    });
  });

  test("does not add issue code pointers for non-code-seeking issue mentions", () => {
    const routing = resolveMentionPromptContextRouting({
      isIssueThreadComment: true,
      prNumber: undefined,
      writeRequest: "thanks for the update",
    });

    expect(routing).toEqual({
      allowIssueCodePointers: false,
      allowPrDiffContext: false,
      includeIssueCorpus: true,
    });
  });
});
