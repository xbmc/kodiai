import { describe, expect, test } from "bun:test";
import type { FormatterSuggestionSubflowResult } from "./formatter-suggestion-orchestration.ts";
import { publishFormatOnlyMentionFormatterResult } from "./mention-format-only-publication.ts";
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
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    headSha: "feature",
    baseRef: "main",
    headRepoOwner: "octo",
    headRepoName: "repo",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Format this PR",
    ...overrides,
  };
}

describe("publishFormatOnlyMentionFormatterResult", () => {
  test("publishes format-only formatter diagnostics and logs the completion summary", async () => {
    const formatterResult: FormatterSuggestionSubflowResult = {
      status: "posted",
      commandStatus: "success",
      publisherStatus: "posted",
      suggestions: 2,
      skipped: 1,
      capped: 0,
      posted: 2,
      reviewOutputKey: "review-output-key",
    };
    const runnerModes: string[] = [];
    const diagnosticInputs: Array<{ formatterMode: string; formatterResult: FormatterSuggestionSubflowResult }> = [];
    const logs: Array<{ fields: Record<string, unknown>; message: string }> = [];

    const publication = await publishFormatOnlyMentionFormatterResult({
      isPrSurface: true,
      formatterSuggestionMode: "format-only",
      runFormatterSuggestionForMention: async (mode) => {
        runnerModes.push(mode);
        return formatterResult;
      },
      postFormatterVisibleDiagnostic: async (input) => {
        diagnosticInputs.push(input);
        return { visibleReplyPosted: true, visibleReplyFailed: false };
      },
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      logger: {
        info: (fields, message) => {
          logs.push({ fields, message });
        },
      },
    });

    expect(publication).toEqual({
      ok: true,
      value: {
        handled: true,
        visibleReplyPosted: true,
        visibleReplyFailed: false,
      },
    });
    expect(runnerModes).toEqual(["format-only"]);
    expect(diagnosticInputs).toEqual([{ formatterResult, formatterMode: "format-only" }]);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("Format-only formatter suggestion request completed");
    expect(logs[0]?.fields).toMatchObject({
      surface: "pr_comment",
      owner: "octo",
      repo: "repo",
      issueNumber: 42,
      prNumber: 42,
      deliveryId: "delivery-1",
      formatterMode: "format-only",
      formatterStatus: "posted",
      suggestions: 2,
      visibleReplyPosted: true,
      visibleReplyFailed: false,
    });
  });

  test("returns false without side effects when the request is not format-only on a PR", async () => {
    let runnerCalled = false;
    let diagnosticCalled = false;
    let logged = false;

    const publication = await publishFormatOnlyMentionFormatterResult({
      isPrSurface: false,
      formatterSuggestionMode: "format-only",
      runFormatterSuggestionForMention: async () => {
        runnerCalled = true;
        throw new Error("should not run");
      },
      postFormatterVisibleDiagnostic: async () => {
        diagnosticCalled = true;
        throw new Error("should not post");
      },
      mention: makeMention({ prNumber: undefined }),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      logger: {
        info: () => {
          logged = true;
        },
      },
    });

    expect(publication).toEqual({
      ok: true,
      value: {
        handled: false,
        visibleReplyPosted: false,
        visibleReplyFailed: false,
      },
    });
    expect(runnerCalled).toBe(false);
    expect(diagnosticCalled).toBe(false);
    expect(logged).toBe(false);
  });

  test("returns an error result when formatter publication throws", async () => {
    const error = new Error("formatter failed");

    const publication = await publishFormatOnlyMentionFormatterResult({
      isPrSurface: true,
      formatterSuggestionMode: "format-only",
      runFormatterSuggestionForMention: async () => {
        throw error;
      },
      postFormatterVisibleDiagnostic: async () => {
        throw new Error("should not post");
      },
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      logger: {
        info: () => undefined,
      },
    });

    expect(publication).toEqual({
      ok: false,
      err: {
        handled: true,
        error,
      },
    });
  });
});
