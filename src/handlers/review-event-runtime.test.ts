import { describe, expect, test } from "bun:test";
import { buildReviewNoReviewSkipGateAdapters } from "./review-event-runtime.ts";

describe("buildReviewNoReviewSkipGateAdapters", () => {
  test("builds no-review skip gate adapters from event runtime dependencies", async () => {
    const octokit = { rest: {} } as never;
    const adapters = buildReviewNoReviewSkipGateAdapters({
      installationId: 123,
      appSlug: "kodiai",
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
    expect(adapters.botHandles).toEqual(["kodiai", "claude"]);
  });
});
