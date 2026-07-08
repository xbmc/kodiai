import {
  fetchAllPullRequestFiles,
  type PullRequestFilesClient,
} from "../lib/github-pr-files.ts";
import type { resolveMentionPromptRuntimeContext } from "./mention-prompt-runtime.ts";

type MentionPromptRuntimeParams = Parameters<typeof resolveMentionPromptRuntimeContext>[0];
type GetPullRequest = MentionPromptRuntimeParams["getPullRequest"];
type ExplicitReviewPullRequest = Awaited<ReturnType<GetPullRequest>>;

type PullRequestClient = PullRequestFilesClient & {
  rest: {
    pulls: PullRequestFilesClient["rest"]["pulls"] & {
      get(params: Parameters<GetPullRequest>[0]): Promise<{ data: ExplicitReviewPullRequest }>;
    };
  };
};

export function buildMentionPromptRuntimeGithubAdapters(
  octokit: PullRequestClient,
): Pick<MentionPromptRuntimeParams, "getPullRequest" | "fetchPullRequestFiles"> {
  return {
    getPullRequest: async (args) => {
      const { data } = await octokit.rest.pulls.get(args);
      return data;
    },
    fetchPullRequestFiles: async (args) => await fetchAllPullRequestFiles({
      octokit,
      owner: args.owner,
      repo: args.repo,
      pullNumber: args.pullNumber,
    }),
  };
}
