import type { Octokit } from "@octokit/rest";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import { ok, type Result } from "../lib/result.ts";

type CostWarningLogger = {
  warn(fields: Record<string, unknown>, message?: string): void;
};

export type MentionCostWarningPublicationStatus =
  | { status: "skipped"; published: false }
  | { status: "published"; published: true }
  | { status: "failed"; published: false };

export type MentionCostWarningPublicationResult =
  Result<MentionCostWarningPublicationStatus, never>;

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
}): Promise<MentionCostWarningPublicationResult> {
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
  return ok({ status: "published", published: true });
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
}): Promise<MentionCostWarningPublicationResult> {
  if (
    params.thresholdUsd <= 0
    || params.costUsd === undefined
    || params.costUsd <= params.thresholdUsd
  ) {
    return ok({ status: "skipped", published: false });
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
      return ok({ status: "skipped", published: false });
    }

    return await postMentionCostWarning({
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
    return ok({ status: "failed", published: false });
  }
}
