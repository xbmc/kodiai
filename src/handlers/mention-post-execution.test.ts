import { describe, expect, mock, test } from "bun:test";
import type { ExecutionResult } from "../execution/types.ts";
import { handleMentionPostExecution } from "./mention-post-execution.ts";
import type { MentionErrorDelivery, MentionPublishResolution } from "./mention-publication-state.ts";
import type { MentionEvent } from "./mention-types.ts";

const mention: MentionEvent = {
  surface: "pr_comment",
  owner: "octo",
  repo: "repo",
  issueNumber: 42,
  prNumber: 42,
  commentId: 1001,
  commentBody: "@kodiai review",
  commentAuthor: "mona",
  commentCreatedAt: "2026-07-07T00:00:00Z",
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
  issueTitle: "Improve widget",
};

const result = {
  conclusion: "failure",
  costUsd: undefined,
  numTurns: undefined,
  durationMs: undefined,
  sessionId: undefined,
  published: false,
  errorMessage: undefined,
  model: undefined,
  inputTokens: undefined,
  outputTokens: undefined,
  cacheReadTokens: undefined,
  cacheCreationTokens: undefined,
  stopReason: "max_turns",
  failureSubtype: "error_max_turns",
  promptSections: [],
} satisfies ExecutionResult;

describe("handleMentionPostExecution", () => {
  test("defers completion logging and reads the latest publication state", async () => {
    const info = mock((_fields: Record<string, unknown>, _message?: string) => undefined);
    const logger = { info, warn: mock(() => undefined) };
    const recordSuccessfulTurn = mock(() => 1);
    let publicationState: {
      mentionFailureSubtype: string | undefined;
      mentionExecutionErrorCategory: undefined;
      mentionOutputPublished: boolean;
      publishResolution: MentionPublishResolution;
      publishFailureCategory: null;
      publishFallbackDelivery: MentionErrorDelivery | null;
    } = {
      mentionFailureSubtype: "error_max_turns",
      mentionExecutionErrorCategory: undefined,
      mentionOutputPublished: false,
      publishResolution: "none",
      publishFailureCategory: null,
      publishFallbackDelivery: null,
    };

    const postExecution = await handleMentionPostExecution({
      logger: logger as never,
      mention,
      result,
      getPublicationState: () => publicationState,
      writeEnabled: false,
      mentionDerivedContextCacheStatus: "bypass",
      mentionDerivedContextCacheReason: null,
      explicitReviewRequest: true,
      reviewOutputKey: "review-key",
      shouldDeferCompletionLog: true,
      recordSuccessfulTurn,
      telemetryEnabled: false,
      telemetryStore: {} as never,
      deliveryId: "delivery-1",
      eventType: "issue_comment.created",
      promptSections: [],
      costWarningUsd: 5,
      canPublishExplicitReviewOutput: () => true,
      getOctokit: async () => {
        throw new Error("telemetry is disabled");
      },
      botHandles: ["kodiai", "claude"],
    });

    expect(info).not.toHaveBeenCalled();
    expect(recordSuccessfulTurn).not.toHaveBeenCalled();

    publicationState = {
      ...publicationState,
      mentionOutputPublished: true,
      publishResolution: "turn-limit-fallback",
      publishFallbackDelivery: "error-comment-created",
    };
    postExecution.logMentionExecutionCompleted();

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatchObject({
      issueNumber: 42,
      conclusion: "expected_bounded",
      publishResolution: "turn-limit-fallback",
      publishFallbackDelivery: "turn-limit-comment-created",
      published: true,
    });
  });
});
