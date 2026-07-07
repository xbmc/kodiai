import { describe, expect, test } from "bun:test";
import { buildReviewTimeoutRetrySettlementAdapters } from "./review-timeout-retry-scheduling.ts";

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
