import type { Logger } from "pino";
import type { Octokit } from "@octokit/rest";
import type { routeAddonRuleReviewMention } from "./addon-review-routing.ts";
import type { MentionEvent } from "./mention-types.ts";
import { postMentionEyesReaction } from "./mention-reactions.ts";

type GetPullRequest = Parameters<typeof routeAddonRuleReviewMention>[0]["getPullRequest"];

type PullRequestClient = {
  rest: {
    pulls: {
      get: GetPullRequest;
    };
  };
};

export function buildMentionRequestPreparationGithubAdapters(
  octokit: PullRequestClient & Octokit,
  mention: MentionEvent,
  logger: Pick<Logger, "warn">,
): {
  getPullRequest: GetPullRequest;
  acknowledgeAddonReview: () => Promise<void>;
} {
  return {
    getPullRequest: (args) => octokit.rest.pulls.get(args),
    acknowledgeAddonReview: () => postMentionEyesReaction({ octokit, mention, logger }),
  };
}
