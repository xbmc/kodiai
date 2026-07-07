import { describe, expect, mock, test } from "bun:test";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { MentionEvent } from "./mention-types.ts";
import { resolveMentionPromptRuntimeContext } from "./mention-prompt-runtime.ts";

const mention: MentionEvent = {
  surface: "issue_comment",
  owner: "xbmc",
  repo: "kodiai",
  issueNumber: 42,
  prNumber: undefined,
  commentId: 1001,
  commentBody: "@kodiai help",
  commentAuthor: "keith",
  commentCreatedAt: "2026-07-07T00:00:00.000Z",
  headRef: undefined,
  baseRef: undefined,
  headRepoOwner: undefined,
  headRepoName: undefined,
  diffHunk: undefined,
  filePath: undefined,
  fileLine: undefined,
  inReplyToId: undefined,
  issueBody: "body",
  issueTitle: "title",
};

describe("resolveMentionPromptRuntimeContext", () => {
  test("uses explicit review prompt builder and returns explicit review metadata", async () => {
    const explicitReviewMention = {
      ...mention,
      prNumber: 7,
      baseRef: "main",
      surface: "pr_comment" as const,
    };
    const buildExplicitReviewPrompt = mock(async () => ({
      prompt: "explicit-review-prompt",
      promptSections: [
        {
          deliveryId: "delivery-1",
          repo: "xbmc/kodiai",
          taskType: "review.full",
          promptKind: "review.prompt",
          sections: [],
        },
      ],
      promptFileCount: 3,
      dynamicTimeoutSeconds: 900,
      maxTurnsOverride: 25,
      prDiffCommentabilityIndex: new Map([["src/app.ts", new Set([12])]]),
      headSha: "head-sha",
      baseSha: "base-sha",
      routing: {
        taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
        routingReason: "tiny-diff",
      },
    }));
    const buildMentionPrompt = mock(() => {
      throw new Error("normal mention prompt should not be built");
    });

    const context = await resolveMentionPromptRuntimeContext({
      explicitReviewRequest: true,
      mention: explicitReviewMention,
      config: { mention: { prompt: "" } } as never,
      deliveryId: "delivery-1",
      workspaceDir: "/tmp/work",
      workspaceToken: "workspace-token",
      retrievalContext: undefined,
      reviewPrecedents: [],
      wikiKnowledge: [],
      unifiedResults: [],
      contextWindow: undefined,
      logger: console as never,
      getPullRequest: async () => ({ head: { sha: "h", ref: "h" }, base: { sha: "b", ref: "b" }, title: "PR" }),
      fetchPullRequestFiles: async () => [],
      mentionContext: "conversation",
      mentionContextSectionMetrics: [],
      userQuestion: "review this",
      findingContext: undefined,
      planOnlyInstructions: undefined,
      writeInstructions: undefined,
      outputLanguage: "en",
      triageContext: "",
      prDiffContext: undefined,
      buildExplicitReviewPrompt: buildExplicitReviewPrompt as never,
      buildMentionPrompt: buildMentionPrompt as never,
    });

    expect(context.prompt).toBe("explicit-review-prompt");
    expect(context.promptSections).toHaveLength(1);
    expect(context.explicitReviewPromptFileCount).toBe(3);
    expect(context.explicitReviewDynamicTimeoutSeconds).toBe(900);
    expect(context.explicitReviewMaxTurnsOverride).toBe(25);
    expect(context.explicitReviewPrDiffCommentabilityIndex).toEqual(new Map([["src/app.ts", new Set([12])]]));
    expect(context.explicitReviewHeadSha).toBe("head-sha");
    expect(context.explicitReviewBaseSha).toBe("base-sha");
    expect(context.explicitReviewRouting).toEqual({
      taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
      routingReason: "tiny-diff",
    });
    expect(buildExplicitReviewPrompt).toHaveBeenCalledTimes(1);
    expect(buildMentionPrompt).not.toHaveBeenCalled();
  });

  test("builds normal mention prompt telemetry records and filters optional prompt inputs", async () => {
    const buildExplicitReviewPrompt = mock(async () => {
      throw new Error("explicit review prompt should not be built");
    });
    const buildMentionPrompt = mock(() => ({
      text: "normal-prompt",
      sections: [
        {
          sectionName: "user",
          sectionPosition: 0,
          charCount: 12,
          estimatedTokens: 3,
        },
      ],
    }));

    const context = await resolveMentionPromptRuntimeContext({
      explicitReviewRequest: false,
      mention,
      config: { mention: { prompt: "" } } as never,
      deliveryId: "delivery-2",
      workspaceDir: "/tmp/work",
      workspaceToken: undefined,
      retrievalContext: undefined,
      reviewPrecedents: [],
      wikiKnowledge: [],
      unifiedResults: [],
      contextWindow: undefined,
      logger: console as never,
      getPullRequest: async () => ({ head: { sha: "h", ref: "h" }, base: { sha: "b", ref: "b" }, title: "PR" }),
      fetchPullRequestFiles: async () => [],
      mentionContext: "conversation",
      mentionContextSectionMetrics: [
        {
          sectionName: "conversation",
          sectionPosition: 0,
          charCount: 12,
          estimatedTokens: 3,
        },
      ],
      userQuestion: "plan this",
      findingContext: undefined,
      planOnlyInstructions: "plan only",
      writeInstructions: "",
      outputLanguage: "en",
      triageContext: "   ",
      prDiffContext: undefined,
      buildExplicitReviewPrompt: buildExplicitReviewPrompt as never,
      buildMentionPrompt: buildMentionPrompt as never,
    });

    expect(context.prompt).toBe("normal-prompt");
    expect(context.explicitReviewPromptFileCount).toBeUndefined();
    expect(context.explicitReviewDynamicTimeoutSeconds).toBeUndefined();
    expect(context.explicitReviewRouting).toEqual({
      taskType: TASK_TYPES.REVIEW_FULL,
      routingReason: "standard",
    });
    expect(context.promptSections).toEqual([
      {
        deliveryId: "delivery-2",
        repo: "xbmc/kodiai",
        taskType: "mention.response",
        promptKind: "mention.context",
        sections: [
          {
            sectionName: "conversation",
            sectionPosition: 0,
            charCount: 12,
            estimatedTokens: 3,
          },
        ],
      },
      {
        deliveryId: "delivery-2",
        repo: "xbmc/kodiai",
        taskType: "mention.response",
        promptKind: "mention.user-prompt",
        sections: [
          {
            sectionName: "user",
            sectionPosition: 0,
            charCount: 12,
            estimatedTokens: 3,
          },
        ],
      },
    ]);
    expect(buildMentionPrompt).toHaveBeenCalledWith(expect.objectContaining({
      customInstructions: "plan only",
      triageContext: undefined,
      unifiedResults: undefined,
    }));
    expect(buildExplicitReviewPrompt).not.toHaveBeenCalled();
  });
});
