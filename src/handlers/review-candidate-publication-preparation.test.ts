import { describe, expect, test } from "bun:test";
import { buildReviewCandidatePublicationPreparationAdapters } from "./review-candidate-publication-preparation.ts";

describe("buildReviewCandidatePublicationPreparationAdapters", () => {
  test("builds candidate publication preparation adapters from handler dependencies", async () => {
    const octokit = { rest: {} } as never;
    const adapters = buildReviewCandidatePublicationPreparationAdapters({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
      appSlug: "kodiai",
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
    expect(adapters.appSlug).toBe("kodiai");
  });
});
