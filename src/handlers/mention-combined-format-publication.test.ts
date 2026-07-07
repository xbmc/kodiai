import { describe, expect, test } from "bun:test";
import type { FormatterSuggestionSubflowResult } from "./formatter-suggestion-orchestration.ts";
import { publishCombinedReviewAndFormatMentionFormatterResult } from "./mention-combined-format-publication.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo",
    repo: "repo",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1001,
    commentBody: "@kodiai review and format",
    commentAuthor: "alice",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "octo",
    headRepoName: "repo",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Review and format this PR",
    ...overrides,
  };
}

describe("publishCombinedReviewAndFormatMentionFormatterResult", () => {
  test("publishes review-and-format formatter diagnostics and logs the combined summary", async () => {
    const formatterResult: FormatterSuggestionSubflowResult = {
      status: "posted",
      commandStatus: "success",
      publisherStatus: "posted",
      suggestions: 3,
      skipped: 1,
      capped: 0,
      posted: 3,
      reviewOutputKey: "review-output-key",
    };
    const runnerModes: string[] = [];
    const diagnosticInputs: Array<{ formatterMode: string; formatterResult: FormatterSuggestionSubflowResult }> = [];
    const logs: Array<{ fields: Record<string, unknown>; message: string }> = [];

    const publication = await publishCombinedReviewAndFormatMentionFormatterResult({
      enabled: true,
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
      result: {
        conclusion: "success",
        stopReason: "complete",
      },
      publishResolution: "executor",
      publishFailureCategory: null,
      publishFallbackDelivery: null,
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
    expect(runnerModes).toEqual(["review-and-format"]);
    expect(diagnosticInputs).toEqual([{ formatterResult, formatterMode: "review-and-format" }]);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("Combined review-and-format mention request completed");
    expect(logs[0]?.fields).toMatchObject({
      surface: "pr_comment",
      owner: "octo",
      repo: "repo",
      issueNumber: 42,
      prNumber: 42,
      deliveryId: "delivery-1",
      formatterMode: "review-and-format",
      formatterStatus: "posted",
      suggestions: 3,
      publishResolution: "executor",
      formatterVisibleReplyPosted: true,
      formatterVisibleReplyFailed: false,
    });
  });

  test("returns false without side effects when combined formatter publication is disabled", async () => {
    let runnerCalled = false;
    let diagnosticCalled = false;
    let logged = false;

    const publication = await publishCombinedReviewAndFormatMentionFormatterResult({
      enabled: false,
      runFormatterSuggestionForMention: async () => {
        runnerCalled = true;
        throw new Error("should not run");
      },
      postFormatterVisibleDiagnostic: async () => {
        diagnosticCalled = true;
        throw new Error("should not post");
      },
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      result: { conclusion: "success" },
      publishResolution: "executor",
      publishFailureCategory: null,
      publishFallbackDelivery: null,
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

  test("returns an error result when combined formatter publication throws", async () => {
    const error = new Error("formatter failed");

    const publication = await publishCombinedReviewAndFormatMentionFormatterResult({
      enabled: true,
      runFormatterSuggestionForMention: async () => {
        throw error;
      },
      postFormatterVisibleDiagnostic: async () => {
        throw new Error("should not post");
      },
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      result: { conclusion: "success" },
      publishResolution: "executor",
      publishFailureCategory: null,
      publishFallbackDelivery: null,
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
