import type { Octokit } from "@octokit/rest";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";

type CostWarningLogger = {
  warn(fields: Record<string, unknown>, message?: string): void;
};

export function buildMentionCostWarningBody(params: {
  costUsd: number;
  thresholdUsd: number;
}): string {
  return `> **Kodiai cost warning:** This execution cost $${params.costUsd.toFixed(4)} USD, exceeding the configured threshold of $${params.thresholdUsd.toFixed(2)} USD.
>
> Configure in \`.kodiai.yml\`:
> \`\`\`yml
> telemetry:
>   costWarningUsd: 5.0  # or 0 to disable
> \`\`\``;
}

export async function postMentionCostWarning(params: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  issueNumber: number;
  costUsd: number;
  thresholdUsd: number;
  botHandles: string[];
}): Promise<void> {
  const octokit = await params.getOctokit();
  await createIssueCommentWithPublicationPipeline(octokit, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: buildMentionCostWarningBody({
      costUsd: params.costUsd,
      thresholdUsd: params.thresholdUsd,
    }),
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });
}

export async function maybePostMentionCostWarning(params: {
  costUsd?: number;
  thresholdUsd: number;
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber?: number;
  explicitReviewRequest: boolean;
  reviewOutputKey?: string;
  canPublishExplicitReviewOutput: (reason: string, reviewOutputKey?: string) => boolean;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
  logger: CostWarningLogger;
}): Promise<void> {
  if (
    params.thresholdUsd <= 0
    || params.costUsd === undefined
    || params.costUsd <= params.thresholdUsd
  ) {
    return;
  }

  params.logger.warn(
    {
      costUsd: params.costUsd,
      threshold: params.thresholdUsd,
      repo: `${params.owner}/${params.repo}`,
      prNumber: params.prNumber,
    },
    "Execution cost exceeded warning threshold",
  );

  try {
    if (
      params.explicitReviewRequest
      && !params.canPublishExplicitReviewOutput(
        "explicit mention review cost warning comment",
        params.reviewOutputKey,
      )
    ) {
      return;
    }

    await postMentionCostWarning({
      getOctokit: params.getOctokit,
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issueNumber,
      costUsd: params.costUsd,
      thresholdUsd: params.thresholdUsd,
      botHandles: params.botHandles,
    });
  } catch (err) {
    params.logger.warn({ err }, "Failed to post cost warning comment (non-blocking)");
  }
}
