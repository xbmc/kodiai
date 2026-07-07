import { describe, expect, test } from "bun:test";
import type { ExecutionContext } from "../execution/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { CandidateVerificationContext } from "../execution/mcp/review-output-publication-gate.ts";
import { buildReviewExecutionContext } from "./review-execution-context.ts";

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
});
