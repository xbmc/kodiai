import type { Logger } from "pino";

export function logPublishedReviewOutputEvidence(params: {
  result: { conclusion: string; published?: boolean };
  logger: Pick<Logger, "info">;
  deliveryId: string;
  installationId: number;
  owner: string;
  repo: string;
  repoName: string;
  prNumber: number;
  reviewOutputKey: string;
}): void {
  if (params.result.conclusion !== "success" || params.result.published !== true) {
    return;
  }

  params.logger.info(
    {
      evidenceType: "review",
      outcome: "published-output",
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      owner: params.owner,
      repoName: params.repoName,
      repo: params.repo,
      prNumber: params.prNumber,
      reviewOutputKey: params.reviewOutputKey,
    },
    "Evidence bundle",
  );
}
