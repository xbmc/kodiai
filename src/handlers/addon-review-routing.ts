import type { Logger } from "pino";
import type { WebhookEvent } from "../webhook/types.ts";

type PullRequestIdentity = {
  base: { ref: string };
  head: {
    ref: string;
    repo: { full_name: string } | null;
  };
};

export function isConfiguredAddonRepo(repo: string, addonRepos: readonly string[]): boolean {
  const normalized = repo.trim().toLowerCase();
  return addonRepos.some((candidate) => candidate.trim().toLowerCase() === normalized);
}

export async function routeAddonRuleReviewMention(params: {
  event: WebhookEvent;
  owner: string;
  repo: string;
  prNumber: number;
  addonRepos: readonly string[];
  getPullRequest: (args: {
    owner: string;
    repo: string;
    pull_number: number;
  }) => Promise<{ data: PullRequestIdentity }>;
  dispatch: (event: WebhookEvent) => Promise<void>;
  logger: Logger;
}): Promise<boolean> {
  const fullName = `${params.owner}/${params.repo}`;
  if (!isConfiguredAddonRepo(fullName, params.addonRepos)) return false;

  const pull = await params.getPullRequest({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.prNumber,
  });
  await params.dispatch({
    id: `${params.event.id}:addon-rule-review`,
    name: "addon_rule_review",
    installationId: params.event.installationId,
    payload: {
      action: "requested",
      pull_request: {
        number: params.prNumber,
        base: { ref: pull.data.base.ref },
        head: {
          ref: pull.data.head.ref,
          repo: pull.data.head.repo
            ? { full_name: pull.data.head.repo.full_name }
            : null,
        },
      },
      repository: {
        full_name: fullName,
        name: params.repo,
        owner: { login: params.owner },
      },
    },
  });
  params.logger.info(
    {
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      gate: "addon-rule-review-routing",
      gateResult: "dispatched",
    },
    "Explicit review mention routed to addon-rule review",
  );
  return true;
}
