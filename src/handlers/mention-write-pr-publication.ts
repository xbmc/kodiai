import type { Octokit } from "@octokit/rest";
import {
  createPullRequestWithPublicationPipeline as defaultCreatePullRequestWithPublicationPipeline,
} from "../lib/github-publication.ts";
import { err, ok, type Result } from "../lib/result.ts";

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

export type MentionWritePullRequestPublicationResult = Result<
  MentionWritePullRequestPublicationResponse,
  unknown
>;

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
}): Promise<MentionWritePullRequestPublicationResult> {
  const createPullRequestWithPublicationPipeline =
    params.createPullRequestWithPublicationPipeline ?? defaultCreatePullRequestWithPublicationPipeline;

  try {
    const response = await createPullRequestWithPublicationPipeline(params.octokit, {
      owner: params.owner,
      repo: params.repo,
      title: params.draft.title,
      head: params.head,
      base: params.base,
      body: params.draft.body,
      botHandles: params.botHandles,
      preserveKodiaiMarkers: true,
    });
    return ok(response);
  } catch (error) {
    return err(error);
  }
}
