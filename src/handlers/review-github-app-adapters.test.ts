import { describe, expect, test } from "bun:test";
import { buildReviewGithubAppAdapters } from "./review-github-app-adapters.ts";

describe("buildReviewGithubAppAdapters", () => {
  test("projects GitHub app methods for handler adapter callsites", async () => {
    const octokit = { marker: "octokit" } as never;
    const installationIds: number[] = [];
    const adapters = buildReviewGithubAppAdapters({
      getInstallationOctokit: async (installationId) => {
        installationIds.push(installationId);
        return octokit;
      },
      getAppSlug: () => "kodiai",
    });

    await expect(adapters.getInstallationOctokit(123)).resolves.toBe(octokit);
    expect(installationIds).toEqual([123]);
    expect(adapters.getAppSlug()).toBe("kodiai");
  });
});
