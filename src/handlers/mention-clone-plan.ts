import type { Octokit } from "@octokit/rest";
import type { MentionEvent } from "./mention-types.ts";

export type MentionClonePlan = {
  cloneOwner: string;
  cloneRepo: string;
  cloneRef: string;
  cloneDepth: number;
  usesPrRef: boolean;
  workspaceStrategy: "base-clone+pull-ref-fetch" | "direct-branch-clone";
};

export async function resolveMentionClonePlan(params: {
  mention: MentionEvent;
  payload: Record<string, unknown>;
  octokit: Octokit;
}): Promise<MentionClonePlan> {
  const { mention, payload, octokit } = params;

  if (mention.prNumber !== undefined) {
    if (!mention.baseRef || !mention.headRef) {
      const { data: pr } = await octokit.rest.pulls.get({
        owner: mention.owner,
        repo: mention.repo,
        pull_number: mention.prNumber,
      });
      mention.headRef = pr.head.ref;
      mention.baseRef = pr.base.ref;
      mention.headRepoOwner = pr.head.repo?.owner.login;
      mention.headRepoName = pr.head.repo?.name;
    }

    return {
      cloneOwner: mention.owner,
      cloneRepo: mention.repo,
      cloneRef: mention.baseRef,
      cloneDepth: 50,
      usesPrRef: true,
      workspaceStrategy: "base-clone+pull-ref-fetch",
    };
  }

  const repository = payload.repository as Record<string, unknown> | undefined;
  return {
    cloneOwner: mention.owner,
    cloneRepo: mention.repo,
    cloneRef: (repository?.default_branch as string | undefined) ?? "main",
    cloneDepth: 1,
    usesPrRef: false,
    workspaceStrategy: "direct-branch-clone",
  };
}
