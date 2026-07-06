import { describe, expect, test } from "bun:test";
import { recordSuccessfulMentionConversationTurn } from "./mention-conversation-recording.ts";

describe("recordSuccessfulMentionConversationTurn", () => {
  test("records successful reply-chain mentions against the PR conversation key", () => {
    const recorded: string[] = [];

    const result = recordSuccessfulMentionConversationTurn({
      owner: "acme",
      repo: "widgets",
      issueNumber: 12,
      prNumber: 34,
      inReplyToId: 99,
      conclusion: "success",
      recordSuccessfulTurn: (key) => {
        recorded.push(key);
        return recorded.length;
      },
    });

    expect(result).toEqual({ recorded: true, conversationKey: "acme/widgets#34" });
    expect(recorded).toEqual(["acme/widgets#34"]);
  });

  test("does not record root mentions or unsuccessful executions", () => {
    const recorded: string[] = [];

    const rootResult = recordSuccessfulMentionConversationTurn({
      owner: "acme",
      repo: "widgets",
      issueNumber: 12,
      prNumber: undefined,
      inReplyToId: undefined,
      conclusion: "success",
      recordSuccessfulTurn: (key) => {
        recorded.push(key);
        return recorded.length;
      },
    });
    const failureResult = recordSuccessfulMentionConversationTurn({
      owner: "acme",
      repo: "widgets",
      issueNumber: 12,
      prNumber: undefined,
      inReplyToId: 99,
      conclusion: "failure",
      recordSuccessfulTurn: (key) => {
        recorded.push(key);
        return recorded.length;
      },
    });

    expect(rootResult).toEqual({ recorded: false });
    expect(failureResult).toEqual({ recorded: false });
    expect(recorded).toEqual([]);
  });
});
