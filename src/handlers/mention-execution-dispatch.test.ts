import { describe, expect, mock, test } from "bun:test";
import type { ExecutionContext, ExecutionResult } from "../execution/types.ts";
import { executeMentionWithFormatterRecovery } from "./mention-execution-dispatch.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_comment",
    owner: "octo-org",
    repo: "widget",
    issueNumber: 42,
    prNumber: 42,
    commentId: 99,
    commentBody: "@kodiai review & format suggestions",
    commentAuthor: "mona",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "octo-org",
    headRepoName: "widget",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Improve widget",
    ...overrides,
  };
}

function makeExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    conclusion: "success",
    published: true,
    costUsd: 0,
    numTurns: 1,
    durationMs: 1,
    sessionId: "session-1",
    errorMessage: undefined,
    model: "model",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    stopReason: "end_turn",
    ...overrides,
  };
}

function makeContext(): ExecutionContext {
  return {
    workspace: { dir: "/tmp/workspace", cleanup: async () => undefined },
    installationId: 123,
    owner: "octo-org",
    repo: "widget",
    prNumber: 42,
    issueNumber: 42,
    commentId: undefined,
    eventType: "issue_comment.created",
    triggerBody: "review & format suggestions",
    prompt: "prompt",
  };
}

describe("executeMentionWithFormatterRecovery", () => {
  test("returns executor result without formatter recovery when execution succeeds", async () => {
    const executionResult = makeExecutionResult();
    const context = makeContext();
    const execute = mock(async (_context: ExecutionContext) => executionResult);
    const runFormatterSuggestionForMention = mock(async () => {
      throw new Error("should not run");
    });

    const result = await executeMentionWithFormatterRecovery({
      execute,
      context,
      isCombinedFormatterSuggestionRequest: true,
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      runFormatterSuggestionForMention,
      postFormatterVisibleDiagnostic: mock(async () => ({ visibleReplyPosted: false, visibleReplyFailed: false })),
      classifyFailure: () => "api_error",
      logger: { warn: () => undefined, info: () => undefined } as never,
    });

    expect(result).toBe(executionResult);
    expect(execute).toHaveBeenCalledWith(context);
    expect(runFormatterSuggestionForMention).not.toHaveBeenCalled();
  });

  test("runs formatter diagnostics and logs combined failure before rethrowing combined executor errors", async () => {
    const thrown = new Error("executor exploded");
    const execute = mock(async () => {
      throw thrown;
    });
    const formatterResult = {
      status: "posted",
      commandStatus: "success",
      publisherStatus: "posted",
      suggestions: 2,
      skipped: 0,
      capped: 0,
      posted: 2,
      reviewOutputKey: "formatter-key",
      partialFailure: false,
    } as const;
    const runFormatterSuggestionForMention = mock(async () => formatterResult);
    const postFormatterVisibleDiagnostic = mock(async () => ({
      visibleReplyPosted: true,
      visibleReplyFailed: false,
    }));
    const warn = mock((_fields: Record<string, unknown>, _message: string) => {});
    const info = mock((_fields: Record<string, unknown>, _message: string) => {});

    await expect(executeMentionWithFormatterRecovery({
      execute,
      context: makeContext(),
      isCombinedFormatterSuggestionRequest: true,
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      runFormatterSuggestionForMention,
      postFormatterVisibleDiagnostic,
      classifyFailure: () => "unknown",
      logger: { warn, info } as never,
    })).rejects.toBe(thrown);

    expect(runFormatterSuggestionForMention).toHaveBeenCalledWith("review-and-format");
    expect(postFormatterVisibleDiagnostic).toHaveBeenCalledWith({
      formatterResult,
      formatterMode: "review-and-format",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "pr_comment",
        owner: "octo-org",
        repo: "widget",
        prNumber: 42,
        formatterSuggestionRequest: true,
        formatterMode: "review-and-format",
        reviewConclusion: "threw",
        failureCategory: "unknown",
      }),
      "Combined review-and-format review executor threw before formatter subflow",
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewConclusion: "threw",
        formatterStatus: "posted",
        formatterVisibleReplyPosted: true,
        combinedPartialFailure: true,
      }),
      "Combined review-and-format formatter subflow completed after review executor threw",
    );
  });

  test("rethrows non-combined executor errors without running formatter recovery", async () => {
    const thrown = new Error("executor exploded");
    const runFormatterSuggestionForMention = mock(async () => {
      throw new Error("should not run");
    });

    await expect(executeMentionWithFormatterRecovery({
      execute: mock(async () => {
        throw thrown;
      }),
      context: makeContext(),
      isCombinedFormatterSuggestionRequest: false,
      mention: makeMention(),
      deliveryId: "delivery-1",
      reviewOutputAction: "mention-format-suggestions",
      runFormatterSuggestionForMention,
      postFormatterVisibleDiagnostic: mock(async () => ({ visibleReplyPosted: false, visibleReplyFailed: false })),
      classifyFailure: () => "unknown",
      logger: { warn: () => undefined, info: () => undefined } as never,
    })).rejects.toBe(thrown);

    expect(runFormatterSuggestionForMention).not.toHaveBeenCalled();
  });
});
