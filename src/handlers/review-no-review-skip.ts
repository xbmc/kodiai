import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";

type NoReviewSkipLogger = Pick<Logger, "info" | "warn">;

export type NoReviewSkipGateDecision =
  | { action: "continue" }
  | { action: "skip" };

export function buildNoReviewSkipAcknowledgmentBody(): string {
  return "Review skipped per `[no-review]` in PR title.";
}

export async function postNoReviewSkipAcknowledgment(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  botHandles: string[];
}): Promise<void> {
  await createIssueCommentWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.prNumber,
    body: buildNoReviewSkipAcknowledgmentBody(),
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });
}

export async function evaluateNoReviewSkipGate(params: {
  prTitle: string;
  owner: string;
  repo: string;
  prNumber: number;
  baseLog: Record<string, unknown>;
  botHandles: string[];
  getOctokit: () => Promise<Octokit>;
  logger: NoReviewSkipLogger;
}): Promise<NoReviewSkipGateDecision> {
  if (!/\[no-review\]/i.test(params.prTitle)) {
    return { action: "continue" };
  }

  params.logger.info(
    { ...params.baseLog, gate: "keyword-skip", gateResult: "skipped" },
    "Review skipped via [no-review] keyword in PR title",
  );

  try {
    await postNoReviewSkipAcknowledgment({
      octokit: await params.getOctokit(),
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      botHandles: params.botHandles,
    });
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "Failed to publish no-review skip acknowledgment (non-fatal)",
    );
  }

  return { action: "skip" };
}
