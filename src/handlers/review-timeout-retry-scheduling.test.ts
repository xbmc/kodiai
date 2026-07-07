import { describe, expect, test } from "bun:test";
import {
  buildReviewTimeoutRetryEnqueueParams,
  buildReviewTimeoutRetryPreEnqueueParams,
  buildReviewTimeoutRetrySettlementAdapters,
} from "./review-timeout-retry-scheduling.ts";

describe("buildReviewTimeoutRetrySettlementAdapters", () => {
  test("builds retry settlement adapters from handler dependencies", async () => {
    const octokit = { rest: {} } as never;
    const phases: unknown[] = [];
    const adapters = buildReviewTimeoutRetrySettlementAdapters({
      retryAttemptId: "attempt-1",
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
      appSlug: "kodiai",
      setReviewWorkPhaseForAttempt: (attemptId, phase) => phases.push({ attemptId, phase }),
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
    expect(adapters.getAppSlug()).toBe("kodiai");
    adapters.setPublishPhase();
    expect(phases).toEqual([{ attemptId: "attempt-1", phase: "publish" }]);
  });
});

describe("buildReviewTimeoutRetryPreEnqueueParams", () => {
  test("projects handler retry context into pre-enqueue side-effect params", () => {
    const persistContinuationFamilyState = async () => undefined;
    const params = buildReviewTimeoutRetryPreEnqueueParams({
      telemetryEnabled: true,
      telemetryStore: {} as never,
      logger: {} as never,
      deliveryId: "delivery-1",
      owner: "acme",
      repo: "widgets",
      pr: { number: 42, user: { login: "octo" } },
      eventAction: "synchronize",
      reviewOutputKey: "review-output-1",
      executionConclusion: "timeout",
      hasPublishedInlines: true,
      timeoutReviewedFiles: ["a.ts"],
      timeoutInspectedFiles: ["a.ts", "b.ts"],
      timeoutFindingCount: 2,
      summaryDraft: "summary",
      timeoutTotalFiles: 4,
      partialCommentId: 99,
      recentTimeouts: 3,
      isChronicTimeout: true,
      timeoutClassificationTelemetry: {} as never,
      timeoutFirstPass: null,
      knowledgeStore: {} as never,
      persistContinuationFamilyState,
    });

    expect(params).toMatchObject({
      telemetryEnabled: true,
      deliveryId: "delivery-1",
      repo: "acme/widgets",
      prNumber: 42,
      prAuthor: "octo",
      eventType: "pull_request.synchronize",
      reviewOutputKey: "review-output-1",
      executionConclusion: "timeout",
      hadInlineOutput: true,
      checkpointFilesReviewed: ["a.ts"],
      checkpointFilesInspected: ["a.ts", "b.ts"],
      checkpointFindingCount: 2,
      checkpointSummaryDraft: "summary",
      checkpointTotalFiles: 4,
      partialCommentId: 99,
      recentTimeouts: 3,
      chronicTimeout: true,
      timeoutFirstPass: null,
    });
    expect(params.persistContinuationFamilyState).toBe(persistContinuationFamilyState);
  });
});

describe("buildReviewTimeoutRetryEnqueueParams", () => {
  test("projects handler queue context into retry enqueue params", () => {
    const jobQueue = {} as never;
    const logger = {} as never;
    const knowledgeStore = {} as never;
    const finalizeContinuationAttempt = async () => undefined;

    const params = buildReviewTimeoutRetryEnqueueParams({
      jobQueue,
      installationId: 123,
      parentDeliveryId: "delivery-1",
      eventName: "pull_request",
      reviewFamilyKey: "family-1",
      pr: { number: 42 },
      reviewOutputKey: "review-output-1",
      knowledgeStore,
      logger,
      finalizeContinuationAttempt,
    });

    expect(params).toEqual({
      jobQueue,
      installationId: 123,
      parentDeliveryId: "delivery-1",
      eventName: "pull_request",
      reviewFamilyKey: "family-1",
      prNumber: 42,
      reviewOutputKey: "review-output-1",
      knowledgeStore,
      logger,
      finalizeContinuationAttempt,
    });
  });
});
