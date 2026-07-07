import { describe, expect, test } from "bun:test";
import type { ExecutionContext } from "../execution/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { FormatterSuggestionRequest } from "./formatter-suggestion-intent.ts";
import { buildMentionExecutionContext } from "./mention-execution-context.ts";
import type { MentionExecutorPlan } from "./mention-executor-plan.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    surface: "pr_review_comment",
    owner: "octo-org",
    repo: "widget",
    issueNumber: 42,
    prNumber: 42,
    commentId: 1234,
    commentBody: "@kodiai review this hunk",
    commentAuthor: "mona",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "feature",
    baseRef: "main",
    headRepoOwner: "octo-org",
    headRepoName: "widget",
    diffHunk: "@@ -1 +1 @@",
    filePath: "src/widget.ts",
    fileLine: 12,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Improve widget",
    ...overrides,
  };
}

function makeExecutorPlan(overrides: Partial<MentionExecutorPlan> = {}): MentionExecutorPlan {
  return {
    reviewOutputKey: "review-output-key",
    maxTurnsOverride: 12,
    taskType: "review.small",
    eventType: "pull_request_review_comment.created",
    triggerBody: "review this hunk",
    isCombinedFormatterSuggestionRequest: false,
    enableInlineTools: true,
    enableCandidateFindingTool: true,
    ...overrides,
  };
}

describe("buildMentionExecutionContext", () => {
  test("projects explicit inline review mention execution context", () => {
    const workspace: ExecutionContext["workspace"] = {
      dir: "/tmp/workspace",
      cleanup: async () => undefined,
      token: "workspace-token",
    };
    const prDiffCommentabilityIndex = {
      commentableRightLinesByPath: new Map([["src/widget.ts", new Set([12])]]),
    } as never;
    const knowledgeStore = { kind: "knowledge-store" } as unknown as KnowledgeStore;
    const formatterSuggestionRequest: FormatterSuggestionRequest = {
      requested: true,
      mode: "review-and-format",
      source: "explicit-mention",
      normalizedRequest: "review and format suggestions",
    };
    const promptSections = [{
      repo: "octo-org/widget",
      taskType: "review.small",
      promptKind: "mention",
      sections: [],
    }];

    expect(buildMentionExecutionContext({
      workspace,
      installationId: 123,
      mention: makeMention(),
      deliveryId: "delivery-1",
      botHandles: ["kodiai", "claude"],
      writeEnabled: false,
      executorPlan: makeExecutorPlan(),
      prompt: "prompt",
      promptSections,
      explicitReviewDynamicTimeoutSeconds: 90,
      knowledgeStore,
      formatterSuggestionRequest,
      explicitReviewPromptFileCount: 4,
      explicitReviewRequest: true,
      explicitReviewPrDiffCommentabilityIndex: prDiffCommentabilityIndex,
    })).toEqual({
      workspace,
      installationId: 123,
      owner: "octo-org",
      repo: "widget",
      prNumber: 42,
      issueNumber: 42,
      commentId: 1234,
      deliveryId: "delivery-1",
      botHandles: ["kodiai", "claude"],
      writeMode: false,
      taskType: "review.small",
      eventType: "pull_request_review_comment.created",
      triggerBody: "review this hunk",
      prompt: "prompt",
      promptSections,
      reviewOutputKey: "review-output-key",
      maxTurnsOverride: 12,
      dynamicTimeoutSeconds: 90,
      knowledgeStore,
      formatterSuggestionRequest,
      totalFiles: 4,
      enableInlineTools: true,
      enableCandidateFindingTool: true,
      prDiffCommentabilityIndex,
    });
  });

  test("omits inline-only and explicit-review-only executor fields for normal mentions", () => {
    const context = buildMentionExecutionContext({
      workspace: { dir: "/tmp/workspace", cleanup: async () => undefined },
      installationId: 123,
      mention: makeMention({
        surface: "pr_comment",
        commentId: 777,
      }),
      deliveryId: "delivery-1",
      botHandles: ["kodiai"],
      writeEnabled: true,
      executorPlan: makeExecutorPlan({
        reviewOutputKey: undefined,
        maxTurnsOverride: undefined,
        taskType: "mention.response",
        enableInlineTools: undefined,
        enableCandidateFindingTool: undefined,
      }),
      prompt: "prompt",
      promptSections: [],
      explicitReviewDynamicTimeoutSeconds: undefined,
      knowledgeStore: undefined,
      formatterSuggestionRequest: undefined,
      explicitReviewPromptFileCount: 0,
      explicitReviewRequest: false,
      explicitReviewPrDiffCommentabilityIndex: { ignored: true } as never,
    });

    expect(context.commentId).toBeUndefined();
    expect(context.reviewOutputKey).toBeUndefined();
    expect(context.maxTurnsOverride).toBeUndefined();
    expect(context.prDiffCommentabilityIndex).toBeUndefined();
    expect(context.writeMode).toBe(true);
  });
});
