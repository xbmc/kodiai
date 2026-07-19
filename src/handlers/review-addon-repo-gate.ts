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
