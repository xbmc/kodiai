import type { Octokit } from "@octokit/rest";

export function buildMentionSetupOctokitAdapters(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
}): { getOctokit: () => Promise<Octokit> } {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
  };
}
