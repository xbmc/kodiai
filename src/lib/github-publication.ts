import type { Octokit } from "@octokit/rest";
import { prepareOutgoingBodyForPublication } from "./sanitizer.ts";
import type { OutgoingPublicationResult } from "./sanitizer.ts";

type IssueCreateParams = NonNullable<Parameters<Octokit["rest"]["issues"]["createComment"]>[0]>;
type IssueUpdateParams = NonNullable<Parameters<Octokit["rest"]["issues"]["updateComment"]>[0]>;
type IssueOpenParams = NonNullable<Parameters<Octokit["rest"]["issues"]["create"]>[0]>;
type IssueEditParams = NonNullable<Parameters<Octokit["rest"]["issues"]["update"]>[0]>;
type PullCreateParams = NonNullable<Parameters<Octokit["rest"]["pulls"]["create"]>[0]>;
type ReviewReplyParams = NonNullable<Parameters<Octokit["rest"]["pulls"]["createReplyForReviewComment"]>[0]>;
type ReviewCommentParams = NonNullable<Parameters<Octokit["rest"]["pulls"]["createReviewComment"]>[0]>;
type PullReviewParams = NonNullable<Parameters<Octokit["rest"]["pulls"]["createReview"]>[0]>;
type PullReviewUpdateParams = {
  owner: string;
  repo: string;
  pull_number: number;
  review_id: number;
  body: string;
};

type PublicationOptions = {
  botHandles: string[];
  preserveKodiaiMarkers?: boolean;
};

export function prepareGitHubPublication(
  body: string,
  options: PublicationOptions,
): OutgoingPublicationResult {
  return prepareOutgoingBodyForPublication(body, options.botHandles, {
    preserveKodiaiMarkers: options.preserveKodiaiMarkers,
  });
}

function publishableBody(body: string, options: PublicationOptions): string {
  return prepareGitHubPublication(body, options).body;
}

export function prepareGitHubPublicationBody(
  body: string,
  options: PublicationOptions,
): string {
  return publishableBody(body, options);
}

export async function createIssueCommentWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<IssueCreateParams, "body"> & { body: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.issues.createComment({
    ...request,
    body: publishableBody(body, { botHandles, preserveKodiaiMarkers }),
  } as IssueCreateParams);
}

export async function updateIssueCommentWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<IssueUpdateParams, "body"> & { body: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.issues.updateComment({
    ...request,
    body: publishableBody(body, { botHandles, preserveKodiaiMarkers }),
  } as IssueUpdateParams);
}

export async function createIssueWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<IssueOpenParams, "body"> & { body?: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.issues.create({
    ...request,
    ...(body !== undefined ? { body: publishableBody(body, { botHandles, preserveKodiaiMarkers }) } : {}),
  } as IssueOpenParams);
}

export async function updateIssueWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<IssueEditParams, "body"> & { body?: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.issues.update({
    ...request,
    ...(body !== undefined ? { body: publishableBody(body, { botHandles, preserveKodiaiMarkers }) } : {}),
  } as IssueEditParams);
}

export async function createPullRequestWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<PullCreateParams, "body"> & { body?: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.pulls.create({
    ...request,
    ...(body !== undefined ? { body: publishableBody(body, { botHandles, preserveKodiaiMarkers }) } : {}),
  } as PullCreateParams);
}

export async function createReviewReplyWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<ReviewReplyParams, "body"> & { body: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.pulls.createReplyForReviewComment({
    ...request,
    body: publishableBody(body, { botHandles, preserveKodiaiMarkers }),
  } as ReviewReplyParams);
}

export async function createReviewCommentWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<ReviewCommentParams, "body"> & { body: string } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.rest.pulls.createReviewComment({
    ...request,
    body: publishableBody(body, { botHandles, preserveKodiaiMarkers }),
  } as ReviewCommentParams);
}

export async function createPullReviewWithPublicationPipeline(
  octokit: Octokit,
  params: Omit<PullReviewParams, "body" | "comments"> & {
    body?: string;
    comments?: NonNullable<PullReviewParams["comments"]>;
  } & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, comments, ...request } = params;
  const options = { botHandles, preserveKodiaiMarkers };
  return await octokit.rest.pulls.createReview({
    ...request,
    ...(body !== undefined ? { body: publishableBody(body, options) } : {}),
    ...(comments !== undefined
      ? {
          comments: comments.map((comment) => ({
            ...comment,
            body: publishableBody(comment.body, options),
          })),
        }
      : {}),
    } as PullReviewParams);
}

export async function updatePullReviewWithPublicationPipeline(
  octokit: Octokit,
  params: PullReviewUpdateParams & PublicationOptions,
) {
  const { botHandles, preserveKodiaiMarkers, body, ...request } = params;
  return await octokit.request(
    "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    {
      ...request,
      body: publishableBody(body, { botHandles, preserveKodiaiMarkers }),
    },
  );
}
