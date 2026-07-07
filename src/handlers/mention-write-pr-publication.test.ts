import type { Octokit } from "@octokit/rest";
import { describe, expect, mock, test } from "bun:test";
import {
  publishMentionWritePullRequest,
  type MentionWritePullRequestDraft,
  type MentionWritePullRequestPublicationResponse,
} from "./mention-write-pr-publication.ts";

describe("publishMentionWritePullRequest", () => {
  test("publishes write-mode PRs through the GitHub publication pipeline", async () => {
    const draft: MentionWritePullRequestDraft = {
      title: "Fix issue",
      body: "Generated patch summary",
    };
    const createPullRequestWithPublicationPipeline = mock(async (
      _octokit: Octokit,
      _params: {
        owner: string;
        repo: string;
        title: string;
        head: string;
        base: string;
        body: string;
        botHandles: string[];
        preserveKodiaiMarkers: true;
      },
    ): Promise<MentionWritePullRequestPublicationResponse> => ({
      data: {
        html_url: "https://github.com/xbmc/kodiai/pull/42",
      },
    }));

    const result = await publishMentionWritePullRequest({
      octokit: {} as Octokit,
      owner: "xbmc",
      repo: "kodiai",
      draft,
      head: "kodiai-fork:fix-issue",
      base: "main",
      botHandles: ["kodiai", "claude"],
      createPullRequestWithPublicationPipeline,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        data: {
          html_url: "https://github.com/xbmc/kodiai/pull/42",
        },
      },
    });
    expect(createPullRequestWithPublicationPipeline).toHaveBeenCalledTimes(1);
    expect(createPullRequestWithPublicationPipeline.mock.calls[0]![1]).toEqual({
      owner: "xbmc",
      repo: "kodiai",
      title: "Fix issue",
      head: "kodiai-fork:fix-issue",
      base: "main",
      body: "Generated patch summary",
      botHandles: ["kodiai", "claude"],
      preserveKodiaiMarkers: true,
    });
  });

  test("returns failed Result when the GitHub publication pipeline rejects", async () => {
    const publishError = new Error("create PR failed");
    const createPullRequestWithPublicationPipeline = mock(async (): Promise<MentionWritePullRequestPublicationResponse> => {
      throw publishError;
    });

    const result = await publishMentionWritePullRequest({
      octokit: {} as Octokit,
      owner: "xbmc",
      repo: "kodiai",
      draft: {
        title: "Fix issue",
        body: "Generated patch summary",
      },
      head: "kodiai-fork:fix-issue",
      base: "main",
      botHandles: ["kodiai", "claude"],
      createPullRequestWithPublicationPipeline,
    });

    expect(result).toEqual({ ok: false, err: publishError });
  });
});
