import { describe, expect, test } from "bun:test";
import { buildReviewSetupOctokitAdapters } from "./review-setup-octokit.ts";

describe("buildReviewSetupOctokitAdapters", () => {
  test("builds setup Octokit adapters from handler dependencies", async () => {
    const octokit = { rest: {} } as never;
    const adapters = buildReviewSetupOctokitAdapters({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
  });
});
