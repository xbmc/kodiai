import { describe, expect, test } from "bun:test";
import { buildMentionSetupOctokitAdapters } from "./mention-setup-octokit.ts";

describe("buildMentionSetupOctokitAdapters", () => {
  test("builds setup Octokit adapters from handler dependencies", async () => {
    const octokit = { rest: {} } as never;
    const adapters = buildMentionSetupOctokitAdapters({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        expect(installationId).toBe(123);
        return octokit;
      },
    });

    await expect(adapters.getOctokit()).resolves.toBe(octokit);
  });
});
