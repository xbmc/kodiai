import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";

export function buildReviewRequestedEyesReactionAdapters(params: {
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
}): Pick<Parameters<typeof maybePostReviewRequestedEyesReaction>[0], "getOctokit"> {
  return {
    getOctokit: () => params.getInstallationOctokit(params.installationId),
  };
}

export async function postReviewRequestedEyesReaction(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  try {
    await params.octokit.rest.reactions.createForIssue({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      content: "eyes",
    });
  } catch (err) {
    params.logger.warn({ err, prNumber: params.prNumber }, "Failed to add eyes reaction to PR");
  }
}

export async function maybePostReviewRequestedEyesReaction(params: {
  action: string;
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  if (params.action !== "review_requested") {
    return;
  }

  await postReviewRequestedEyesReaction({
    octokit: await params.getOctokit(),
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    logger: params.logger,
  });
}

export async function publishReviewRequestedEyesReactionFromHandlerDependencies(params: {
  action: string;
  installationId: number;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  const adapters = buildReviewRequestedEyesReactionAdapters({
    installationId: params.installationId,
    getInstallationOctokit: params.getInstallationOctokit,
  });

  await maybePostReviewRequestedEyesReaction({
    action: params.action,
    getOctokit: adapters.getOctokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    logger: params.logger,
  });
}
