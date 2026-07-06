import { describe, expect, test } from "bun:test";
import { buildMentionWritePullRequestDraft } from "./mention-write-pr-draft.ts";

describe("buildMentionWritePullRequestDraft", () => {
  test("builds PR title and body with best-effort diff stat and fabrication warnings", async () => {
    const result = await buildMentionWritePullRequestDraft({
      workspaceDir: "/tmp/workspace",
      issueTitle: "Fix plugin crash",
      writeRequest: "please fix the plugin crash",
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: undefined,
      triggerCommentUrl: "https://github.com/xbmc/kodiai/issues/42#issuecomment-99",
      deliveryId: "delivery-1",
      headSha: "abc123",
      getDiffStat: async () => "src/addon.ts | 2 +-",
      scanFabricatedContent: async () => ["Suspicious generated path: imaginary.ts"],
    });

    expect(result.title).toBe("fix: Fix plugin crash");
    expect(result.body).toContain("Resolves #42");
    expect(result.body).toContain("src/addon.ts | 2 +-");
    expect(result.body).toContain("Suspicious generated path: imaginary.ts");
    expect(result.sourceUrl).toBe("https://github.com/xbmc/kodiai/issues/42");
  });

  test("keeps PR body creation best-effort when diff stat and fabrication scans fail", async () => {
    const result = await buildMentionWritePullRequestDraft({
      workspaceDir: "/tmp/workspace",
      issueTitle: null,
      writeRequest: "update the docs",
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: 7,
      triggerCommentUrl: "https://github.com/xbmc/kodiai/pull/7#discussion_r1",
      deliveryId: "delivery-2",
      headSha: "def456",
      getDiffStat: async () => {
        throw new Error("diff failed");
      },
      scanFabricatedContent: async () => {
        throw new Error("scan failed");
      },
    });

    expect(result.title).toBe("fix: update the docs");
    expect(result.body).toContain("Related to #7");
    expect(result.body).not.toContain("## Changes");
    expect(result.body).not.toContain("## Automated warnings");
    expect(result.sourceUrl).toBe("https://github.com/xbmc/kodiai/pull/7");
  });
});
