import type { Octokit } from "@octokit/rest";

export type ReviewGithubAppAdapterSource = {
  getInstallationOctokit(installationId: number): Promise<Octokit>;
  getAppSlug(): string;
};

export function buildReviewGithubAppAdapters(githubApp: ReviewGithubAppAdapterSource): {
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  getAppSlug: () => string;
} {
  return {
    getInstallationOctokit: (installationId) => githubApp.getInstallationOctokit(installationId),
    getAppSlug: () => githubApp.getAppSlug(),
  };
}
