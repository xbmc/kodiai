import { describe, expect, test } from "bun:test";
import { buildMentionPostExecutorPublicationAdapters } from "./mention-post-executor-publication.ts";

describe("buildMentionPostExecutorPublicationAdapters", () => {
  test("builds post-executor publication adapters from handler dependencies", async () => {
    const octokit = { rest: {} } as never;
    const adapters = buildMentionPostExecutorPublicationAdapters({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
  });
});
