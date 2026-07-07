import { describe, expect, test } from "bun:test";
import { maybePublishDisabledWriteModeRefusal } from "./mention-write-disabled.ts";

function mentionFixture() {
  return {
    surface: "issue_comment",
    owner: "xbmc",
    repo: "kodiai",
    issueNumber: 42,
    prNumber: 42,
    commentAuthor: "keith",
  } as never;
}

describe("maybePublishDisabledWriteModeRefusal", () => {
  test("returns skipped Result when request is not a disabled write", async () => {
    const result = await maybePublishDisabledWriteModeRefusal({
      isWriteRequest: false,
      isPlanOnly: false,
      writeEnabled: false,
      mention: mentionFixture(),
      keyword: null,
      writeKeyword: "write",
      writeRequest: "change it",
      appSlug: "kodiai",
      logger: { info: () => undefined },
      postMentionReply: async () => undefined,
    });

    expect(result).toEqual({
      ok: true,
      value: { status: "skipped", refused: false },
    });
  });

  test("returns refused Result after posting disabled write-mode reply", async () => {
    const replies: Array<{ body: string; options?: { sanitizeMentions?: boolean } }> = [];

    const result = await maybePublishDisabledWriteModeRefusal({
      isWriteRequest: true,
      isPlanOnly: false,
      writeEnabled: false,
      mention: mentionFixture(),
      keyword: "write",
      writeKeyword: "write",
      writeRequest: "change it",
      appSlug: "kodiai",
      logger: { info: () => undefined },
      postMentionReply: async (body, options) => {
        replies.push({ body, options });
      },
    });

    expect(result).toEqual({
      ok: true,
      value: { status: "refused", refused: true },
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toContain("@kodiai write: change it");
    expect(replies[0]?.options).toEqual({ sanitizeMentions: false });
  });
});
