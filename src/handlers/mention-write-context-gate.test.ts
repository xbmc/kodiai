import { describe, expect, test } from "bun:test";
import { evaluateMentionWriteContextGate } from "./mention-write-context-gate.ts";

describe("mention write context gate", () => {
  test("allows non-write requests", () => {
    expect(evaluateMentionWriteContextGate({
      isWriteRequest: false,
      isIssueThreadComment: false,
      prNumber: undefined,
    })).toEqual({ allowed: true });
  });

  test("allows write requests on PR surfaces", () => {
    expect(evaluateMentionWriteContextGate({
      isWriteRequest: true,
      isIssueThreadComment: false,
      prNumber: 42,
    })).toEqual({ allowed: true });
  });

  test("allows issue-thread write requests", () => {
    expect(evaluateMentionWriteContextGate({
      isWriteRequest: true,
      isIssueThreadComment: true,
      prNumber: undefined,
    })).toEqual({ allowed: true });
  });

  test("returns the PR-context reply for write requests outside PR or issue-thread context", () => {
    const result = evaluateMentionWriteContextGate({
      isWriteRequest: true,
      isIssueThreadComment: false,
      prNumber: undefined,
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.replyBody).toContain("I can only apply changes in a PR context.");
      expect(result.replyOptions).toEqual({ sanitizeMentions: false });
    }
  });
});
