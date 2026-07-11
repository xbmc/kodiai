import type { Octokit } from "@octokit/rest";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import { err, ok, toError, type Result } from "../lib/result.ts";

type CostWarningLogger = {
  warn(fields: Record<string, unknown>, message?: string): void;
};

export type ReviewCostWarningPublicationStatus =
  | { status: "skipped"; published: false }
  | { status: "published"; published: true }
  | { status: "failed"; published: false };

export type ReviewCostWarningPublicationResult =
  Result<ReviewCostWarningPublicationStatus>;

export function buildReviewCostWarningBody(params: {
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

export async function postReviewCostWarning(params: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  costUsd: number;
  thresholdUsd: number;
  botHandles: string[];
}): Promise<ReviewCostWarningPublicationResult> {
  try {
    const octokit = await params.getOctokit();
    await createIssueCommentWithPublicationPipeline(octokit, {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.prNumber,
      body: buildReviewCostWarningBody({
        costUsd: params.costUsd,
        thresholdUsd: params.thresholdUsd,
      }),
      botHandles: params.botHandles,
      preserveKodiaiMarkers: true,
    });
    return ok({ status: "published", published: true });
  } catch (error) {
    return err(toError(error));
  }
}

export async function maybePostReviewCostWarning(params: {
  costUsd?: number;
  thresholdUsd: number;
  owner: string;
  repo: string;
  prNumber: number;
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  getOctokit: () => Promise<Octokit>;
  botHandles: string[];
  logger: CostWarningLogger;
}): Promise<ReviewCostWarningPublicationResult> {
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
    if (!params.canPublishVisibleOutput("cost warning comment")) {
      return ok({ status: "skipped", published: false });
    }

    params.setReviewWorkPhase("publish");
    const publication = await postReviewCostWarning({
      getOctokit: params.getOctokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      costUsd: params.costUsd,
      thresholdUsd: params.thresholdUsd,
      botHandles: params.botHandles,
    });
    if (!publication.ok) {
      params.logger.warn(
        { err: publication.err },
        "Failed to publish review cost warning comment (non-blocking)",
      );
      return ok({ status: "failed", published: false });
    }
    return publication;
  } catch (err) {
    params.logger.warn({ err }, "Failed to publish review cost warning comment (non-blocking)");
    return ok({ status: "failed", published: false });
  }
}
