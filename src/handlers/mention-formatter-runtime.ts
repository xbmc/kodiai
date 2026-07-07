import type { Logger } from "pino";
import type { Workspace } from "../jobs/types.ts";
import {
  fetchAllPullRequestFiles,
  type PullRequestFilesClient,
} from "../lib/github-pr-files.ts";
import { classifyError } from "../lib/errors.ts";
import type { FormatterSuggestionPublisherOctokit } from "../execution/formatter-suggestion-publisher.ts";
import {
  createFormatterSuggestionMentionRunner,
  createFormatterSuggestionVisibleDiagnosticPoster,
  type FormatterSuggestionMentionRunner,
  type FormatterSuggestionVisibleDiagnosticPoster,
} from "./formatter-suggestion-orchestration.ts";
import type { MentionEvent } from "./mention-types.ts";

type FormatterRuntimeOctokit = PullRequestFilesClient;

export interface MentionFormatterRuntime {
  runFormatterSuggestionForMention: FormatterSuggestionMentionRunner;
  postFormatterVisibleDiagnostic: FormatterSuggestionVisibleDiagnosticPoster;
}

export function createMentionFormatterRuntime(params: {
  workspace: Workspace;
  mention: MentionEvent;
  formatterCommand?: string;
  maxSuggestions: number;
  installationId: number;
  deliveryId: string;
  reviewOutputAction: string;
  octokit: FormatterRuntimeOctokit;
  botHandles: string[];
  postReply: (body: string) => Promise<unknown>;
  formatterSuggestionSubflow?: Parameters<typeof createFormatterSuggestionMentionRunner>[0]["formatterSuggestionSubflow"];
  logger: Logger;
}): MentionFormatterRuntime {
  const runFormatterSuggestionForMention = createFormatterSuggestionMentionRunner({
    workspace: params.workspace,
    owner: params.mention.owner,
    repo: params.mention.repo,
    prNumber: params.mention.prNumber,
    baseRef: params.mention.baseRef,
    headRef: params.mention.headRef,
    formatterCommand: params.formatterCommand,
    maxSuggestions: params.maxSuggestions,
    installationId: params.installationId,
    deliveryId: params.deliveryId,
    reviewOutputAction: params.reviewOutputAction,
    octokit: params.octokit as unknown as FormatterSuggestionPublisherOctokit,
    botHandles: params.botHandles,
    logger: params.logger,
    logContext: {
      surface: params.mention.surface,
    },
    classifyFailure: (err) => classifyError(err, false),
    fetchPullRequestFiles: (request) => fetchAllPullRequestFiles({
      octokit: params.octokit,
      owner: request.owner,
      repo: request.repo,
      pullNumber: request.pullNumber,
    }),
    formatterSuggestionSubflow: params.formatterSuggestionSubflow,
  });

  const postFormatterVisibleDiagnostic = createFormatterSuggestionVisibleDiagnosticPoster({
    postReply: params.postReply,
    logger: params.logger,
    logContext: {
      surface: params.mention.surface,
      owner: params.mention.owner,
      repo: params.mention.repo,
      prNumber: params.mention.prNumber,
    },
    classifyFailure: (err) => classifyError(err, false),
  });

  return {
    runFormatterSuggestionForMention,
    postFormatterVisibleDiagnostic,
  };
}
