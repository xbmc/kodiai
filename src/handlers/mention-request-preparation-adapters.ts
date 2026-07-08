import type { routeAddonRuleReviewMention } from "./addon-review-routing.ts";

type GetPullRequest = Parameters<typeof routeAddonRuleReviewMention>[0]["getPullRequest"];

type PullRequestClient = {
  rest: {
    pulls: {
      get: GetPullRequest;
    };
  };
};

export function buildMentionRequestPreparationGithubAdapters(
  octokit: PullRequestClient,
): { getPullRequest: GetPullRequest } {
  return {
    getPullRequest: (args) => octokit.rest.pulls.get(args),
  };
}
