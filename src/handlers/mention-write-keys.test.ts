import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { buildWriteBranchName, buildWriteOutputKey } from "./mention-write-keys.ts";

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
});
