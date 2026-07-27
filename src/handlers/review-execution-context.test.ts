import { describe, expect, test } from "bun:test";
import type { ExecutionContext } from "../execution/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { CandidateVerificationContext } from "../execution/mcp/review-output-publication-gate.ts";
import { buildReviewBotHandles, buildReviewExecutionContext, buildReviewRetryExecutionContext } from "./review-execution-context.ts";

describe("buildReviewBotHandles", () => {
  test("projects the app slug and Claude alias used for review publication sanitization", () => {
    expect(buildReviewBotHandles("kodiai")).toEqual(["kodiai", "claude"]);
  });
});

describe("buildReviewExecutionContext", () => {
  test("projects the initial review executor context", () => {
    const workspace: ExecutionContext["workspace"] = {
      dir: "/tmp/review-workspace",
      cleanup: async () => undefined,
      token: "workspace-token",
    };
    const promptSections = [{
      repo: "xbmc/kodiai",
      taskType: "review.full",
      promptKind: "review",
      sections: [],
    }];
    const candidateVerificationContext: CandidateVerificationContext = {
      docsConfigTruth: null,
      deliveryId: "delivery-1",
      reviewOutputKey: "review-output-key",
      correlationKey: "correlation-1",
    };
    const prDiffCommentabilityIndex = {
      commentableRightLinesByPath: new Map([["src/app.ts", new Set([12])]]),
    } as never;
    const knowledgeStore = { kind: "knowledge-store" } as unknown as KnowledgeStore;

    expect(buildReviewExecutionContext({
      workspace,
      installationId: 123,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      appSlug: "kodiai",
      action: "synchronize",
      taskType: "review.full",
      reviewPrompt: "prompt body",
      reviewPromptSections: promptSections,
      reviewOutputKey: "review-output-key",
      canonicalReviewOutputKey: "canonical-review-output-key",
      deliveryId: "delivery-1",
      candidateVerificationContext,
      knowledgeStore,
      changedFileCount: 9,
      checkpointEnabled: true,
      prDiffCommentabilityIndex,
      appliedTimeoutBudget: {
        totalTimeoutSeconds: 900,
      },
      reviewMaxTurnsOverride: 44,
    })).toEqual({
      workspace,
      installationId: 123,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      commentId: undefined,
      botHandles: ["kodiai", "claude"],
      eventType: "pull_request.synchronize",
      taskType: "review.full",
      triggerBody: "prompt body",
      prompt: "prompt body",
      promptSections,
      reviewOutputKey: "review-output-key",
      canonicalReviewOutputKey: "canonical-review-output-key",
      deliveryId: "delivery-1",
      candidateVerificationContext,
      knowledgeStore,
      totalFiles: 9,
      enableCheckpointTool: true,
      enableCandidateFindingTool: true,
      prDiffCommentabilityIndex,
      dynamicTimeoutSeconds: 900,
      maxTurnsOverride: 44,
    });
  });

  test("leaves dynamic timeout unset when no applied timeout budget exists", () => {
    const context = buildReviewExecutionContext({
      workspace: { dir: "/tmp/review-workspace", cleanup: async () => undefined },
      installationId: 123,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      appSlug: "kodiai",
      action: "opened",
      taskType: "review.full",
      reviewPrompt: "prompt body",
      reviewPromptSections: [],
      reviewOutputKey: "review-output-key",
      canonicalReviewOutputKey: "canonical-review-output-key",
      deliveryId: "delivery-1",
      candidateVerificationContext: undefined,
      knowledgeStore: undefined,
      changedFileCount: 0,
      checkpointEnabled: false,
      prDiffCommentabilityIndex: undefined,
      appliedTimeoutBudget: null,
      reviewMaxTurnsOverride: undefined,
    });

    expect(context.dynamicTimeoutSeconds).toBeUndefined();
    expect(context.enableCheckpointTool).toBe(false);
    expect(context.candidateVerificationContext).toBeUndefined();
  });

  test("projects the timeout retry review executor context", () => {
    const workspace: ExecutionContext["workspace"] = {
      dir: "/tmp/retry-review-workspace",
      cleanup: async () => undefined,
    };
    const retryPromptSections = [{
      repo: "xbmc/kodiai",
      taskType: "review.full",
      promptKind: "review-retry",
      sections: [],
    }];
    const prDiffCommentabilityIndex = {
      commentableRightLinesByPath: new Map([["src/retry.ts", new Set([22])]]),
    } as never;
    const knowledgeStore = { kind: "knowledge-store" } as unknown as KnowledgeStore;

    expect(buildReviewRetryExecutionContext({
      workspace,
      installationId: 123,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      appSlug: "kodiai",
      taskType: "review.full",
      retryPrompt: "retry prompt body",
      retryPromptSections,
      retryReviewOutputKey: "retry-output-key",
      retryDeliveryId: "delivery-1-retry-1",
      retryTimeoutSeconds: 450,
      reviewMaxTurnsOverride: 33,
      knowledgeStore,
      timeoutTotalFiles: 7,
      retryCheckpointEnabled: true,
      prDiffCommentabilityIndex,
    })).toEqual({
      workspace,
      installationId: 123,
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      commentId: undefined,
      botHandles: ["kodiai", "claude"],
      eventType: "pull_request.review-retry",
      taskType: "review.full",
      triggerBody: "",
      prompt: "retry prompt body",
      promptSections: retryPromptSections,
      reviewOutputKey: "retry-output-key",
      // "retry-output-key" isn't a well-formed reviewOutputKey (see the dedicated
      // parse test below for the real-format derivation), so it falls back to itself.
      canonicalReviewOutputKey: "retry-output-key",
      deliveryId: "delivery-1-retry-1",
      candidateVerificationContext: {
        docsConfigTruth: null,
        deliveryId: "delivery-1-retry-1",
        reviewOutputKey: "retry-output-key",
        correlationKey: expect.stringMatching(/^[a-f0-9]{16}$/),
      },
      dynamicTimeoutSeconds: 450,
      maxTurnsOverride: 33,
      knowledgeStore,
      totalFiles: 7,
      enableCheckpointTool: true,
      prDiffCommentabilityIndex,
      enableCommentTools: false,
    });
  });

  test("derives the canonical key from a well-formed retry reviewOutputKey (same PR/commit as the original)", () => {
    const workspace: ExecutionContext["workspace"] = {
      dir: "/tmp/retry-review-workspace",
      cleanup: async () => undefined,
    };
    const retryReviewOutputKey =
      "kodiai-review-output:v1:inst-42:acme/repo:pr-101:action-synchronize:delivery-abc123:head-deadbeef-retry-1";

    const context = buildReviewRetryExecutionContext({
      workspace,
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber: 101,
      appSlug: "kodiai",
      taskType: "review.full",
      retryPrompt: "retry prompt body",
      retryPromptSections: [],
      retryReviewOutputKey,
      retryDeliveryId: "delivery-abc123-retry-1",
      retryTimeoutSeconds: 450,
      reviewMaxTurnsOverride: undefined,
      knowledgeStore: undefined,
      timeoutTotalFiles: 0,
      retryCheckpointEnabled: false,
      prDiffCommentabilityIndex: undefined,
    });

    // No action/delivery segments -- so a mention-triggered re-review of the same
    // PR/commit resolves the exact same canonical key.
    expect(context.canonicalReviewOutputKey).toBe(
      "kodiai-review-output:v1:inst-42:acme/repo:pr-101:head-deadbeef",
    );
  });
});
