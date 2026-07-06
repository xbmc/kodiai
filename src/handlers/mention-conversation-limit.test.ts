import { describe, expect, test } from "bun:test";
import {
  buildMentionConversationKey,
  evaluateMentionConversationLimit,
} from "./mention-conversation-limit.ts";

describe("mention conversation limit", () => {
  test("builds a stable repo and thread key for PR conversations", () => {
    expect(buildMentionConversationKey({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 9,
      prNumber: 42,
    })).toBe("xbmc/kodiai#42");
  });

  test("uses issue number for issue-thread conversations", () => {
    expect(buildMentionConversationKey({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 9,
      prNumber: undefined,
    })).toBe("xbmc/kodiai#9");
  });

  test("allows top-level mentions without checking the turn store", () => {
    let checked = false;

    const result = evaluateMentionConversationLimit({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 9,
      prNumber: undefined,
      inReplyToId: undefined,
      maxTurnsPerPr: 1,
      getTurns: () => {
        checked = true;
        return 99;
      },
    });

    expect(result).toEqual({ limited: false });
    expect(checked).toBe(false);
  });

  test("returns the existing limit reply when reply turns reach the cap", () => {
    const result = evaluateMentionConversationLimit({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 9,
      prNumber: undefined,
      inReplyToId: 900,
      maxTurnsPerPr: 1,
      getTurns: (key) => {
        expect(key).toBe("xbmc/kodiai#9");
        return 1;
      },
    });

    expect(result).toEqual({
      limited: true,
      replyBody: [
        "Conversation limit reached (1 turns per PR).",
        "Start a new thread or open a new issue for further questions.",
      ].join("\n"),
    });
  });
});
