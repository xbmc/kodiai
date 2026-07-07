import { describe, expect, test } from "bun:test";
import { createMentionFormatterRuntime } from "./mention-formatter-runtime.ts";
import type { FormatterSuggestionSubflowOptions } from "./formatter-suggestion-orchestration.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo",
    repo: "repo",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1001,
    commentBody: "@kodiai format",
    commentAuthor: "alice",
    commentCreatedAt: "2026-07-07T00:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "octo",
    headRepoName: "repo",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Format this",
    ...overrides,
  };
}

describe("createMentionFormatterRuntime", () => {
  test("binds formatter runner dependencies and fallback file providers", async () => {
    let capturedOptions: FormatterSuggestionSubflowOptions | undefined;
    const runtime = createMentionFormatterRuntime({
      workspace: { dir: "/tmp/work", token: "token", cleanup: async () => {} },
      mention: makeMention(),
      formatterCommand: "bun fmt",
      maxSuggestions: 3,
      installationId: 123,
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      octokit: {
        rest: {
          pulls: {
            listFiles: async () => ({
              data: [
                {
                  filename: "src/a.ts",
                  status: "modified",
                  previous_filename: null,
                  additions: 1,
                  deletions: 0,
                  patch: "@@",
                },
              ],
            }),
          },
        },
      },
      botHandles: ["kodiai"],
      postReply: async () => {},
      formatterSuggestionSubflow: async (options) => {
        capturedOptions = options;
        expect(await options.fallbackFileProvider?.()).toEqual(["src/a.ts"]);
        expect(await options.fallbackDiffProvider?.()).toEqual([
          {
            filename: "src/a.ts",
            status: "modified",
            previousFilename: undefined,
            additions: 1,
            deletions: 0,
            patch: "@@",
          },
        ]);
        return {
          status: "posted",
          suggestions: 1,
          skipped: 0,
          capped: 0,
        };
      },
      logger: { warn: () => {} } as never,
    });

    const result = await runtime.runFormatterSuggestionForMention("format-only");

    expect(result.status).toBe("posted");
    expect(capturedOptions).toMatchObject({
      owner: "octo",
      repo: "repo",
      prNumber: 42,
      workspaceDir: "/tmp/work",
      baseRef: "main",
      headRef: "feature",
      formatterCommand: "bun fmt",
      maxSuggestions: 3,
      installationId: 123,
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      botHandles: ["kodiai"],
    });
  });

  test("binds visible diagnostic publication context", async () => {
    const replies: string[] = [];
    const runtime = createMentionFormatterRuntime({
      workspace: { dir: "/tmp/work", cleanup: async () => {} },
      mention: makeMention(),
      maxSuggestions: 3,
      installationId: 123,
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      octokit: {
        rest: {
          pulls: {
            listFiles: async () => ({ data: [] }),
          },
        },
      },
      botHandles: ["kodiai"],
      postReply: async (body) => {
        replies.push(body);
      },
      logger: { warn: () => {} } as never,
    });

    const result = await runtime.postFormatterVisibleDiagnostic({
      formatterMode: "format-only",
      formatterResult: {
        status: "failed",
        suggestions: 0,
        skipped: 0,
        capped: 0,
        reason: "formatter crashed",
        visibleMessage: "Formatter crashed visibly.",
      },
    });

    expect(result).toEqual({ visibleReplyPosted: true, visibleReplyFailed: false });
    expect(replies.join("\n")).toContain("Formatter crashed visibly.");
  });
});
