import type { Logger } from "pino";
import {
  createBranchCommitAndPush as defaultCreateBranchCommitAndPush,
  WritePolicyError,
} from "../jobs/workspace.ts";
import { ok, type Result } from "../lib/result.ts";
import { buildWritePolicyRefusalMessage } from "../lib/write-policy-formatting.ts";
import { buildMentionWriteCommitMessage } from "./mention-write-formatters.ts";
import {
  buildExistingPrReply,
  buildIssueWriteSuccessReply,
  buildWritePolicyRefusalReply,
  type IssueWriteFailureStep,
  type WritePermissionFailureReplyResult,
} from "./mention-write-replies.ts";
import {
  buildMentionWritePullRequestDraft as defaultBuildMentionWritePullRequestDraft,
  type MentionWritePullRequestDraft,
} from "./mention-write-pr-draft.ts";
import {
  publishMentionWritePullRequest as defaultPublishMentionWritePullRequest,
  type MentionWritePullRequestPublicationResult,
} from "./mention-write-pr-publication.ts";

type BotWriteMention = {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber?: number;
  baseRef?: string;
  issueTitle: string | null;
  commentId: number;
};

type WritePolicy = {
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
};

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

type PostMentionReply = (
  body: string,
  options?: { sanitizeMentions?: boolean },
) => Promise<void>;

type CreateBranchCommitAndPush = (input: {
  dir: string;
  branchName: string;
  commitMessage: string;
  policy: WritePolicy;
  token?: string;
}) => Promise<{ branchName: string; headSha: string }>;

type BuildMentionWritePullRequestDraft = typeof defaultBuildMentionWritePullRequestDraft;
type PublishMentionWritePullRequest = (params: {
  octokit: PullsListOctokit;
  owner: string;
  repo: string;
  draft: MentionWritePullRequestDraft;
  head: string;
  base: string;
  botHandles: string[];
}) => Promise<MentionWritePullRequestPublicationResult>;

export type BotWritePullRequestStatus = {
  status: "handled";
};

export async function publishMentionBotWritePullRequest(params: {
  workspaceDir: string;
  workspaceToken?: string;
  octokit: PullsListOctokit;
  mention: BotWriteMention;
  cloneRef?: string;
  writeBranchName: string;
  writeOutputKey: string;
  writeRequest: string;
  triggerCommentUrl: string;
  deliveryId: string;
  installationId: number;
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
  retryCommand: string;
  isIssueWritePublishFlow: boolean;
  botHandles: string[];
  logger: Logger;
  postMentionReply: PostMentionReply;
  postIssueWriteFailure: (step: IssueWriteFailureStep, err: unknown) => Promise<void>;
  maybeReplyWritePermissionFailure: (input: {
    err: unknown;
    retryCommand: string;
    postReply: PostMentionReply;
  }) => Promise<WritePermissionFailureReplyResult>;
  createBranchCommitAndPush?: CreateBranchCommitAndPush;
  buildMentionWritePullRequestDraft?: BuildMentionWritePullRequestDraft;
  publishMentionWritePullRequest?: PublishMentionWritePullRequest;
  recordWriteRateLimitSuccess: (owner: string, repo: string) => void;
}): Promise<Result<BotWritePullRequestStatus>> {
  const createBranchCommitAndPush = params.createBranchCommitAndPush ?? defaultCreateBranchCommitAndPush;
  const buildMentionWritePullRequestDraft =
    params.buildMentionWritePullRequestDraft ?? defaultBuildMentionWritePullRequestDraft;
  const publishMentionWritePullRequest =
    params.publishMentionWritePullRequest ?? (
      defaultPublishMentionWritePullRequest as unknown as PublishMentionWritePullRequest
    );

  const branchName = params.writeBranchName;
  const sourceRef = params.mention.prNumber !== undefined
    ? `PR #${params.mention.prNumber}`
    : `#${params.mention.issueNumber}`;
  const commitMessage = buildMentionWriteCommitMessage({
    issueTitle: params.mention.issueTitle,
    request: params.writeRequest,
    isFromPr: params.mention.prNumber !== undefined,
    sourceRef,
    marker: `kodiai-write-output-key: ${params.writeOutputKey}`,
    deliveryId: params.deliveryId,
  });

  let pushed: { branchName: string; headSha: string };
  try {
    pushed = await createBranchCommitAndPush({
      dir: params.workspaceDir,
      branchName,
      commitMessage,
      policy: {
        allowPaths: params.allowPaths,
        denyPaths: params.denyPaths,
        secretScanEnabled: params.secretScanEnabled,
      },
      token: params.workspaceToken,
    });
  } catch (err) {
    if (err instanceof WritePolicyError) {
      const refusal = buildWritePolicyRefusalMessage(err, params.allowPaths);
      const replyBody = buildWritePolicyRefusalReply({ refusal });
      await params.postMentionReply(replyBody);
      return ok({ status: "handled" });
    }

    const permissionReply = await params.maybeReplyWritePermissionFailure({
      err,
      retryCommand: params.retryCommand,
      postReply: params.postMentionReply,
    });
    if (permissionReply.ok && permissionReply.value.status === "handled") {
      return ok({ status: "handled" });
    }

    if (err instanceof Error && looksLikeExistingBranchFailure(err)) {
      try {
        const { data: prs } = await params.octokit.rest.pulls.list({
          owner: params.mention.owner,
          repo: params.mention.repo,
          state: "all",
          head: `${params.mention.owner}:${branchName}`,
          per_page: 5,
        });
        const existing = prs[0];
        if (existing?.html_url) {
          const replyBody = buildExistingPrReply({ prUrl: existing.html_url });
          await params.postMentionReply(replyBody);
          return ok({ status: "handled" });
        }
      } catch (lookupErr) {
        params.logger.warn(
          { err: lookupErr, prNumber: params.mention.prNumber, branchName },
          "Failed to look up existing PR after push failure",
        );
      }
    }

    await params.postIssueWriteFailure("branch-push", err);
    return ok({ status: "handled" });
  }

  const prDraft: MentionWritePullRequestDraft = await buildMentionWritePullRequestDraft({
    workspaceDir: params.workspaceDir,
    issueTitle: params.mention.issueTitle,
    writeRequest: params.writeRequest,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    triggerCommentUrl: params.triggerCommentUrl,
    deliveryId: params.deliveryId,
    headSha: pushed.headSha,
  });

  const prBaseRef = params.mention.prNumber !== undefined ? (params.mention.baseRef ?? "main") : (params.cloneRef ?? "main");

  let createdPr: { html_url: string } | undefined;
  const maxPrCreateAttempts = params.isIssueWritePublishFlow ? 2 : 1;
  for (let attempt = 1; attempt <= maxPrCreateAttempts; attempt++) {
    try {
      const response = await publishMentionWritePullRequest({
        octokit: params.octokit,
        owner: params.mention.owner,
        repo: params.mention.repo,
        draft: prDraft,
        head: pushed.branchName,
        base: prBaseRef,
        botHandles: params.botHandles,
      });
      if (!response.ok) {
        throw response.err;
      }
      createdPr = response.value.data;
      break;
    } catch (err) {
      const permissionReply = await params.maybeReplyWritePermissionFailure({
        err,
        retryCommand: params.retryCommand,
        postReply: params.postMentionReply,
      });
      if (permissionReply.ok && permissionReply.value.status === "handled") {
        return ok({ status: "handled" });
      }

      if (attempt < maxPrCreateAttempts) {
        params.logger.warn(
          {
            err,
            owner: params.mention.owner,
            repo: params.mention.repo,
            issueNumber: params.mention.issueNumber,
            attempt,
            maxAttempts: maxPrCreateAttempts,
            branchName: pushed.branchName,
            writeOutputKey: params.writeOutputKey,
          },
          "Issue write-mode PR creation failed, retrying once",
        );
        continue;
      }

      await params.postIssueWriteFailure("create-pr", err);
      return ok({ status: "handled" });
    }
  }

  if (!createdPr?.html_url) {
    await params.postIssueWriteFailure(
      "create-pr",
      new Error("GitHub pulls.create response did not include html_url"),
    );
    return ok({ status: "handled" });
  }

  const issueLinkbackUrl =
    params.mention.prNumber !== undefined
      ? `https://github.com/${params.mention.owner}/${params.mention.repo}/pull/${params.mention.prNumber}`
      : `https://github.com/${params.mention.owner}/${params.mention.repo}/issues/${params.mention.issueNumber}`;

  const replyBody = buildIssueWriteSuccessReply({
    prUrl: createdPr.html_url,
    issueLinkbackUrl,
  });
  try {
    await params.postMentionReply(replyBody);
  } catch (err) {
    await params.postIssueWriteFailure("issue-linkback", err);
    return ok({ status: "handled" });
  }

  params.logger.info(
    {
      evidenceType: "write-mode",
      outcome: "created-pr",
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      owner: params.mention.owner,
      repoName: params.mention.repo,
      repo: `${params.mention.owner}/${params.mention.repo}`,
      sourcePrNumber: params.mention.prNumber,
      triggerCommentId: params.mention.commentId,
      triggerCommentUrl: params.triggerCommentUrl,
      writeOutputKey: params.writeOutputKey,
      branchName,
      prUrl: createdPr.html_url,
      commitSha: pushed.headSha,
    },
    "Evidence bundle",
  );

  params.recordWriteRateLimitSuccess(params.mention.owner, params.mention.repo);

  return ok({ status: "handled" });
}

function looksLikeExistingBranchFailure(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("non-fast-forward")
    || msg.includes("fetch first")
    || msg.includes("rejected")
    || msg.includes("already exists");
}
