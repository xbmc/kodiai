import type { Logger } from "pino";

export type GenericReviewAddonRepoGateDecision =
  | { action: "continue" }
  | { action: "skip"; reason: "specialized-addon-review" };

export function evaluateGenericReviewAddonRepoGate(params: {
  repositoryFullName: string | undefined;
  addonRepos: readonly string[];
}): GenericReviewAddonRepoGateDecision {
  const repo = params.repositoryFullName?.trim().toLowerCase();
  if (!repo) return { action: "continue" };

  return params.addonRepos.some((candidate) => candidate.trim().toLowerCase() === repo)
    ? { action: "skip", reason: "specialized-addon-review" }
    : { action: "continue" };
}

export function shouldSkipGenericReviewForAddonRepo(params: {
  deliveryId: string;
  repositoryFullName: string | undefined;
  addonRepos: readonly string[];
  logger: Pick<Logger, "info">;
}): boolean {
  const decision = evaluateGenericReviewAddonRepoGate(params);
  if (decision.action === "continue") return false;

  params.logger.info(
    {
      deliveryId: params.deliveryId,
      gate: "generic-review-addon-repo",
      gateResult: "skipped",
      skipReason: decision.reason,
    },
    "Generic review skipped for specialized addon repository",
  );
  return true;
}
