import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildMentionWriteContext,
  buildMentionTriggerCommentUrl,
  buildWriteBranchName,
  buildWriteOutputKey,
} from "./mention-write-keys.ts";

describe("mention write keys", () => {
  test("builds stable write output keys", () => {
    const key = buildWriteOutputKey({
      installationId: 1,
      owner: "XBMC",
      repo: "KodiAI",
      sourceType: "issue",
      sourceNumber: 42,
      commentId: 7,
      keyword: "apply",
    });

    expect(key).toBe("kodiai-write-output:v1:inst-1:xbmc/kodiai:issue-42:comment-7:keyword-apply");
  });

  test("derives deterministic branch names from write output keys", () => {
    const writeOutputKey = "kodiai-write-output:v1:inst-1:xbmc/kodiai:issue-42:comment-7:keyword-apply";
    const hash = createHash("sha256").update(writeOutputKey).digest("hex").slice(0, 12);
    expect(buildWriteBranchName({
      sourceType: "issue",
      sourceNumber: 42,
      commentId: 7,
      writeOutputKey,
    })).toBe(`kodiai/apply/issue-42-comment-7-${hash}`);
  });

  test("builds trigger comment URLs for issue and PR mention surfaces", () => {
    expect(buildMentionTriggerCommentUrl({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: undefined,
      commentId: 123,
    })).toBe("https://github.com/xbmc/kodiai/issues/42#issuecomment-123");

    expect(buildMentionTriggerCommentUrl({
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: 99,
      commentId: 123,
    })).toBe("https://github.com/xbmc/kodiai/pull/99#issuecomment-123");
  });

  test("builds enabled write context for PR mention surfaces", () => {
    const context = buildMentionWriteContext({
      writeEnabled: true,
      writeKeyword: "apply",
      writeRequest: "fix the docs",
      installationId: 7,
      owner: "XBMC",
      repo: "KodiAI",
      issueNumber: 42,
      prNumber: 99,
      commentId: 123,
      appSlug: "kodiai",
    });

    expect(context.writeSource).toEqual({ type: "pr", number: 99 });
    expect(context.retryCommand).toBe("@kodiai apply: fix the docs");
    expect(context.triggerCommentUrl).toBe("https://github.com/XBMC/KodiAI/pull/99#issuecomment-123");
    expect(context.writeOutputKey).toBe("kodiai-write-output:v1:inst-7:xbmc/kodiai:pr-99:comment-123:keyword-apply");
    expect(context.writeBranchName).toContain("kodiai/apply/pr-99-comment-123-");
  });

  test("omits output key and branch when write mode is disabled", () => {
    const context = buildMentionWriteContext({
      writeEnabled: false,
      writeKeyword: "change",
      writeRequest: "",
      installationId: 7,
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: undefined,
      commentId: 123,
      appSlug: "kodiai",
    });

    expect(context.writeSource).toEqual({ type: "issue", number: 42 });
    expect(context.retryCommand).toBe("@kodiai change: <same request>");
    expect(context.triggerCommentUrl).toBe("https://github.com/xbmc/kodiai/issues/42#issuecomment-123");
    expect(context.writeOutputKey).toBeUndefined();
    expect(context.writeBranchName).toBeUndefined();
  });
});
