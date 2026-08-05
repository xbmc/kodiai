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
      scanFabricatedContent: async () => ({
        warnings: ["Suspicious generated path: imaginary.ts"],
        complete: true,
      }),
    });

    expect(result.title).toBe("fix: Fix plugin crash");
    expect(result.body).toContain("Resolves #42");
    expect(result.body).toContain("src/addon.ts | 2 +-");
    expect(result.body).toContain("Suspicious generated path: imaginary.ts");
    expect(result.sourceUrl).toBe("https://github.com/xbmc/kodiai/issues/42");
  });

  test("keeps PR body creation best-effort and surfaces unavailable fabrication scans", async () => {
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
    expect(result.warnings).toEqual([
      "Fabricated-content scan incomplete; review the generated changes manually.",
    ]);
    expect(result.body).toContain("Fabricated-content scan incomplete; review the generated changes manually.");
    expect(result.sourceUrl).toBe("https://github.com/xbmc/kodiai/pull/7");
  });

  test("preserves detector warnings and appends one warning for incomplete scans", async () => {
    const draft = await buildMentionWritePullRequestDraft({
      workspaceDir: "/tmp/workspace",
      issueTitle: "Fix plugin crash",
      writeRequest: "please fix the plugin crash",
      owner: "xbmc",
      repo: "kodiai",
      issueNumber: 42,
      prNumber: undefined,
      triggerCommentUrl: "https://github.com/xbmc/kodiai/issues/42#issuecomment-99",
      deliveryId: "delivery-3",
      headSha: "abc123",
      getDiffStat: async () => "",
      scanFabricatedContent: async () => ({
        warnings: ["detected-marker"],
        complete: false,
        reason: "output-truncated",
      }),
    });

    expect(draft.warnings).toEqual([
      "detected-marker",
      "Fabricated-content scan incomplete; review the generated changes manually.",
    ]);
  });
});
