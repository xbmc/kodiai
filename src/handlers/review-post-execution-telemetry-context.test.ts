import { describe, expect, test } from "bun:test";
import { buildReviewPostExecutionTelemetryPublicationContext, recordReviewPostExecutionTelemetryForInstallation } from "./review-post-execution-telemetry-context.ts";

describe("buildReviewPostExecutionTelemetryPublicationContext", () => {
  test("binds post-execution telemetry publication adapters to the installation and bot handles", async () => {
    const calls: number[] = [];
    const octokit = { marker: "octokit" };

    const context = buildReviewPostExecutionTelemetryPublicationContext({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        calls.push(installationId);
        return octokit;
      },
      appSlug: "kodiai",
    });

    await expect(context.getOctokit()).resolves.toBe(octokit);
    expect(calls).toEqual([123]);
    expect(context.botHandles).toEqual(["kodiai", "claude"]);
  });
});

describe("recordReviewPostExecutionTelemetryForInstallation", () => {
  test("binds publication adapters and forwards telemetry parameters", async () => {
    const octokit = { marker: "octokit" };
    const installationCalls: number[] = [];
    const recordCalls: unknown[] = [];
    const result = {
      conclusion: "success",
      published: false,
      costUsd: 6,
    };
    const promptSections = [{
      repo: "xbmc/kodiai",
      taskType: "review.full",
      promptKind: "review",
      sections: [],
    }];

    await recordReviewPostExecutionTelemetryForInstallation({
      installationId: 123,
      getInstallationOctokit: (async (installationId: number) => {
        installationCalls.push(installationId);
        return octokit;
      }) as any,
      appSlug: "kodiai",
      telemetryEnabled: true,
      telemetryStore: {} as any,
      logger: { warn: () => undefined },
      deliveryId: "delivery-1",
      owner: "xbmc",
      repo: "kodiai",
      prNumber: 42,
      prAuthor: "author",
      eventAction: "opened",
      result: result as any,
      promptSections: promptSections as any,
      derivedPromptCacheStatus: "hit" as any,
      derivedPromptCacheReason: "cache-hit",
      costWarningUsd: 5,
      canPublishVisibleOutput: () => true,
      setReviewWorkPhase: () => undefined,
      recordTelemetry: async (params) => {
        recordCalls.push(params);
        await params.getOctokit();
      },
    });

    expect(installationCalls).toEqual([123]);
    expect(recordCalls).toEqual([
      expect.objectContaining({
        telemetryEnabled: true,
        deliveryId: "delivery-1",
        owner: "xbmc",
        repo: "kodiai",
        prNumber: 42,
        prAuthor: "author",
        eventType: "pull_request.opened",
        result,
        promptSections,
        derivedPromptCacheStatus: "hit",
        derivedPromptCacheReason: "cache-hit",
        costWarningUsd: 5,
        botHandles: ["kodiai", "claude"],
      }),
    ]);
  });
});
