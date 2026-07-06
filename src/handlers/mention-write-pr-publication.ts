import type { Octokit } from "@octokit/rest";
import {
  createPullRequestWithPublicationPipeline as defaultCreatePullRequestWithPublicationPipeline,
} from "../lib/github-publication.ts";

export type MentionWritePullRequestDraft = {
  title: string;
  body: string;
};

type MentionWritePullRequestPublicationParams = {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
  botHandles: string[];
  preserveKodiaiMarkers: true;
};

export type MentionWritePullRequestPublicationResponse = {
  data: {
    html_url: string;
  };
};

type CreatePullRequestWithPublicationPipeline = (
  octokit: Octokit,
  params: MentionWritePullRequestPublicationParams,
) => Promise<MentionWritePullRequestPublicationResponse>;

export async function publishMentionWritePullRequest(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  draft: MentionWritePullRequestDraft;
  head: string;
  base: string;
  botHandles: string[];
  createPullRequestWithPublicationPipeline?: CreatePullRequestWithPublicationPipeline;
}): Promise<MentionWritePullRequestPublicationResponse> {
  const createPullRequestWithPublicationPipeline =
    params.createPullRequestWithPublicationPipeline ?? defaultCreatePullRequestWithPublicationPipeline;

  return createPullRequestWithPublicationPipeline(params.octokit, {
    owner: params.owner,
    repo: params.repo,
    title: params.draft.title,
    head: params.head,
    base: params.base,
    body: params.draft.body,
    botHandles: params.botHandles,
    preserveKodiaiMarkers: true,
  });
}
