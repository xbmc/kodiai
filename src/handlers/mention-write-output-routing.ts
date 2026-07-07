import type { Logger } from "pino";
import {
  getGitStatusPorcelain as defaultGetGitStatusPorcelain,
} from "../jobs/workspace.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import { buildNoFileChangesReply, createIssueWriteFailurePoster } from "./mention-write-replies.ts";
import type { MentionEvent } from "./mention-types.ts";
import {
  isSameRepoPrHead,
} from "./mention-pr-write.ts";
import { attemptSameRepoPrWrite as defaultAttemptSameRepoPrWrite } from "./mention-same-repo-write.ts";
import { publishMentionBotWritePullRequest as defaultPublishMentionBotWritePullRequest } from "./mention-bot-pr-write.ts";
import { publishMentionForkWriteOutput as defaultPublishMentionForkWriteOutput } from "./mention-fork-write-output.ts";

type ForkContext = {
  forkOwner: string;
  forkRepo: string;
  botPat: string;
};

type PostMentionReply = (
  body: string,
  options?: { sanitizeMentions?: boolean },
) => Promise<void>;

type PullsListOctokit = {
  rest: {
    pulls: {
      list(params: {
        owner: string;
        repo: string;
        state: "all";
        head: string;
        per_page: number;
      }): Promise<{ data: Array<{ html_url?: string | null }> }>;
    };
  };
};

type PublishMentionForkWriteOutput = typeof defaultPublishMentionForkWriteOutput;
type AttemptSameRepoPrWrite = typeof defaultAttemptSameRepoPrWrite;
type PublishMentionBotWritePullRequest = typeof defaultPublishMentionBotWritePullRequest;

export async function routeMentionWriteOutput(params: {
  workspaceDir: string;
  workspaceToken?: string;
  octokit: PullsListOctokit;
  mention: MentionEvent;
  forkContext: ForkContext | undefined;
  gistPublisher: Pick<GistPublisher, "enabled" | "createPatchGist"> | undefined;
  writeKeyword: string;
  writeBranchName: string;
  writeOutputKey: string;
  writeRequest: string;
  triggerCommentUrl: string;
  deliveryId: string;
  installationId: number;
  cloneRef?: string;
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
  retryCommand: string;
  isIssueThreadComment: boolean;
  botHandles: string[];
  logger: Logger;
  postMentionReply: PostMentionReply;
  maybeReplyWritePermissionFailure: (input: {
    err: unknown;
    retryCommand: string;
    postReply: PostMentionReply;
  }) => Promise<boolean>;
  recordWriteRateLimitSuccess: (owner: string, repo: string) => void;
  getGitStatusPorcelain?: (workspaceDir: string) => Promise<string>;
  publishMentionForkWriteOutput?: PublishMentionForkWriteOutput;
  attemptSameRepoPrWrite?: AttemptSameRepoPrWrite;
  publishMentionBotWritePullRequest?: PublishMentionBotWritePullRequest;
}): Promise<{ status: "handled" }> {
  const getGitStatusPorcelain = params.getGitStatusPorcelain ?? defaultGetGitStatusPorcelain;
  const publishMentionForkWriteOutput =
    params.publishMentionForkWriteOutput ?? defaultPublishMentionForkWriteOutput;
  const attemptSameRepoPrWrite = params.attemptSameRepoPrWrite ?? defaultAttemptSameRepoPrWrite;
  const publishMentionBotWritePullRequest =
    params.publishMentionBotWritePullRequest ?? defaultPublishMentionBotWritePullRequest;

  const postIssueWriteFailure = createIssueWriteFailurePoster({
    isIssueWritePublishFlow: params.isIssueThreadComment,
    retryCommand: params.retryCommand,
    postReply: params.postMentionReply,
    logger: params.logger,
    logContext: {
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      owner: params.mention.owner,
      repoName: params.mention.repo,
      repo: `${params.mention.owner}/${params.mention.repo}`,
      sourcePrNumber: params.mention.prNumber,
      triggerCommentId: params.mention.commentId,
      triggerCommentUrl: params.triggerCommentUrl,
      writeOutputKey: params.writeOutputKey,
    },
  });

  const status = await getGitStatusPorcelain(params.workspaceDir);
  if (status.trim().length === 0) {
    const replyBody = buildNoFileChangesReply();
    await params.postMentionReply(replyBody);
    return { status: "handled" };
  }

  const forkWriteOutput = await publishMentionForkWriteOutput({
    workspaceDir: params.workspaceDir,
    octokit: params.octokit,
    mention: params.mention,
    forkContext: params.forkContext,
    gistPublisher: params.gistPublisher,
    writeKeyword: params.writeKeyword,
    writeBranchName: params.writeBranchName,
    writeOutputKey: params.writeOutputKey,
    writeRequest: params.writeRequest,
    triggerCommentUrl: params.triggerCommentUrl,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    cloneRef: params.cloneRef,
    allowPaths: params.allowPaths,
    denyPaths: params.denyPaths,
    secretScanEnabled: params.secretScanEnabled,
    botHandles: params.botHandles,
    logger: params.logger,
    postMentionReply: params.postMentionReply,
    recordWriteRateLimitSuccess: params.recordWriteRateLimitSuccess,
  });
  if (forkWriteOutput.status === "handled") {
    return { status: "handled" };
  }

  const sourcePrUrl =
    params.mention.prNumber !== undefined
      ? `https://github.com/${params.mention.owner}/${params.mention.repo}/pull/${params.mention.prNumber}`
      : undefined;

  const sameRepoHead = isSameRepoPrHead({
    owner: params.mention.owner,
    repo: params.mention.repo,
    headRepoOwner: params.mention.headRepoOwner,
    headRepoName: params.mention.headRepoName,
    headRef: params.mention.headRef,
  });

  const sameRepoPrWriteResult = await attemptSameRepoPrWrite({
    workspaceDir: params.workspaceDir,
    workspaceToken: params.workspaceToken,
    mention: params.mention,
    sameRepoHead,
    sourcePrUrl,
    writeOutputKey: params.writeOutputKey,
    writeBranchName: params.writeBranchName,
    writeRequest: params.writeRequest,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    triggerCommentUrl: params.triggerCommentUrl,
    allowPaths: params.allowPaths,
    denyPaths: params.denyPaths,
    secretScanEnabled: params.secretScanEnabled,
    retryCommand: params.retryCommand,
    logger: params.logger,
    postMentionReply: params.postMentionReply,
    maybeReplyWritePermissionFailure: params.maybeReplyWritePermissionFailure,
  });
  if (sameRepoPrWriteResult.status === "handled") {
    return { status: "handled" };
  }

  await publishMentionBotWritePullRequest({
    workspaceDir: params.workspaceDir,
    workspaceToken: params.workspaceToken,
    octokit: params.octokit,
    mention: params.mention,
    cloneRef: params.cloneRef,
    writeBranchName: params.writeBranchName,
    writeOutputKey: params.writeOutputKey,
    writeRequest: params.writeRequest,
    triggerCommentUrl: params.triggerCommentUrl,
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    allowPaths: params.allowPaths,
    denyPaths: params.denyPaths,
    secretScanEnabled: params.secretScanEnabled,
    retryCommand: params.retryCommand,
    isIssueWritePublishFlow: params.isIssueThreadComment,
    botHandles: params.botHandles,
    logger: params.logger,
    postMentionReply: params.postMentionReply,
    postIssueWriteFailure,
    maybeReplyWritePermissionFailure: params.maybeReplyWritePermissionFailure,
    recordWriteRateLimitSuccess: params.recordWriteRateLimitSuccess,
  });

  return { status: "handled" };
}
