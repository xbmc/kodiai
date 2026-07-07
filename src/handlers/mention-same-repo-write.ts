import { $ } from "bun";
import type { Logger } from "pino";
import {
  commitAndPushToRemoteRef as defaultCommitAndPushToRemoteRef,
  pushHeadToRemoteRef as defaultPushHeadToRemoteRef,
  WritePolicyError,
} from "../jobs/workspace.ts";
import { ok, type Result } from "../lib/result.ts";
import { buildWritePolicyRefusalMessage } from "../lib/write-policy-formatting.ts";
import { buildMentionWriteCommitMessage } from "./mention-write-formatters.ts";
import {
  buildAlreadyAppliedReply,
  buildUpdatedPrReply,
  buildWritePolicyRefusalReply,
} from "./mention-write-replies.ts";
import {
  buildWriteOutputIdempotencyMarker,
  remoteHeadContainsMarker as defaultRemoteHeadContainsMarker,
} from "./mention-pr-write.ts";

type SameRepoMention = {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber?: number;
  issueTitle: string | null;
  commentId: number;
  headRef?: string;
};

type WritePolicy = {
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
};

export type SameRepoWriteOperationStatus = {
  status: "handled" | "fall-through" | "not-applicable";
};

type CheckoutPrHead = (input: {
  workspaceDir: string;
  branch: string;
}) => Promise<void>;

type RemoteHeadContainsMarker = (input: {
  dir: string;
  branch: string;
  token?: string;
  marker: string;
}) => Promise<boolean>;

type CommitAndPushToRemoteRef = (input: {
  dir: string;
  remoteRef: string;
  commitMessage: string;
  policy: WritePolicy;
  token?: string;
}) => Promise<{ headSha: string }>;

type PushHeadToRemoteRef = (input: {
  dir: string;
  remoteRef: string;
  token?: string;
}) => Promise<void>;

type PostMentionReply = (
  body: string,
  options?: { sanitizeMentions?: boolean },
) => Promise<void>;

export async function attemptSameRepoPrWrite(params: {
  workspaceDir: string;
  workspaceToken?: string;
  mention: SameRepoMention;
  sameRepoHead: boolean;
  sourcePrUrl: string | undefined;
  writeOutputKey: string;
  writeBranchName: string;
  writeRequest: string;
  deliveryId: string;
  installationId: number;
  triggerCommentUrl: string;
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
  retryCommand: string;
  logger: Logger;
  postMentionReply: PostMentionReply;
  maybeReplyWritePermissionFailure: (input: {
    err: unknown;
    retryCommand: string;
    postReply: PostMentionReply;
  }) => Promise<boolean>;
  checkoutPrHead?: CheckoutPrHead;
  remoteHeadContainsMarker?: RemoteHeadContainsMarker;
  commitAndPushToRemoteRef?: CommitAndPushToRemoteRef;
  pushHeadToRemoteRef?: PushHeadToRemoteRef;
}): Promise<Result<SameRepoWriteOperationStatus>> {
  if (params.mention.prNumber === undefined || !params.sameRepoHead || !params.mention.headRef) {
    return ok({ status: "not-applicable" });
  }

  const headRef = params.mention.headRef;
  const idempotencyMarker = buildWriteOutputIdempotencyMarker(params.writeOutputKey);
  const remoteHeadContainsMarker = params.remoteHeadContainsMarker ?? defaultRemoteHeadContainsMarker;
  const checkoutPrHead = params.checkoutPrHead ?? defaultCheckoutPrHead;
  const commitAndPushToRemoteRef = params.commitAndPushToRemoteRef ?? defaultCommitAndPushToRemoteRef;
  const pushHeadToRemoteRef = params.pushHeadToRemoteRef ?? defaultPushHeadToRemoteRef;

  try {
    const alreadyApplied = await remoteHeadContainsMarker({
      dir: params.workspaceDir,
      branch: headRef,
      token: params.workspaceToken,
      marker: idempotencyMarker,
    });
    if (alreadyApplied) {
      await logAndReplyAlreadyApplied(params, params.sourcePrUrl);
      return ok({ status: "handled" });
    }
  } catch (err) {
    params.logger.warn(
      { err, prNumber: params.mention.prNumber, headRef },
      "Failed to check idempotency marker on head ref; continuing",
    );
  }

  try {
    await checkoutPrHead({
      workspaceDir: params.workspaceDir,
      branch: headRef,
    });

    const commitMessage = buildMentionWriteCommitMessage({
      issueTitle: params.mention.issueTitle,
      request: params.writeRequest,
      isFromPr: true,
      sourceRef: `PR #${params.mention.prNumber}`,
      marker: idempotencyMarker,
      deliveryId: params.deliveryId,
    });

    const pushed = await commitAndPushToRemoteRef({
      dir: params.workspaceDir,
      remoteRef: headRef,
      commitMessage,
      policy: {
        allowPaths: params.allowPaths,
        denyPaths: params.denyPaths,
        secretScanEnabled: params.secretScanEnabled,
      },
      token: params.workspaceToken,
    });

    params.logger.info(
      {
        evidenceType: "write-mode",
        outcome: "updated-pr-branch",
        deliveryId: params.deliveryId,
        installationId: params.installationId,
        owner: params.mention.owner,
        repoName: params.mention.repo,
        repo: `${params.mention.owner}/${params.mention.repo}`,
        sourcePrNumber: params.mention.prNumber,
        triggerCommentId: params.mention.commentId,
        triggerCommentUrl: params.triggerCommentUrl,
        writeOutputKey: params.writeOutputKey,
        headRef,
        commitSha: pushed.headSha,
        prUrl: params.sourcePrUrl,
      },
      "Evidence bundle",
    );

    const replyBody = buildUpdatedPrReply({ prUrl: params.sourcePrUrl });
    try {
      await params.postMentionReply(replyBody);
    } catch (replyErr) {
      params.logger.warn(
        { err: replyErr, prNumber: params.mention.prNumber, headRef },
        "Applied changes but failed to post confirmation reply",
      );
    }
    return ok({ status: "handled" });
  } catch (err) {
    if (err instanceof WritePolicyError) {
      const refusal = buildWritePolicyRefusalMessage(err, params.allowPaths);
      const replyBody = buildWritePolicyRefusalReply({ refusal });
      await params.postMentionReply(replyBody);
      return ok({ status: "handled" });
    }

    if (await params.maybeReplyWritePermissionFailure({
      err,
      retryCommand: params.retryCommand,
      postReply: params.postMentionReply,
    })) {
      return ok({ status: "handled" });
    }

    try {
      const alreadyApplied = await remoteHeadContainsMarker({
        dir: params.workspaceDir,
        branch: headRef,
        token: params.workspaceToken,
        marker: idempotencyMarker,
      });
      if (alreadyApplied) {
        await logAndReplyAlreadyApplied(params, params.sourcePrUrl);
        return ok({ status: "handled" });
      }
    } catch (lookupErr) {
      params.logger.warn(
        { err: lookupErr, prNumber: params.mention.prNumber, headRef },
        "Failed to re-check idempotency marker after push failure",
      );
    }

    params.logger.warn(
      { err, prNumber: params.mention.prNumber, headRef },
      "Failed to push to PR head branch; falling back to bot PR",
    );

    try {
      await pushHeadToRemoteRef({
        dir: params.workspaceDir,
        remoteRef: params.writeBranchName,
        token: params.workspaceToken,
      });
    } catch (pushErr) {
      if (await params.maybeReplyWritePermissionFailure({
        err: pushErr,
        retryCommand: params.retryCommand,
        postReply: params.postMentionReply,
      })) {
        return ok({ status: "handled" });
      }
      params.logger.error(
        { err: pushErr, prNumber: params.mention.prNumber, branchName: params.writeBranchName },
        "Fallback push to bot branch failed",
      );
      throw err;
    }

    return ok({ status: "fall-through" });
  }
}

async function defaultCheckoutPrHead(input: {
  workspaceDir: string;
  branch: string;
}): Promise<void> {
  await $`git -C ${input.workspaceDir} checkout -B pr-head refs/remotes/origin/${input.branch}`.quiet();
}

async function logAndReplyAlreadyApplied(
  params: Parameters<typeof attemptSameRepoPrWrite>[0],
  prUrl: string | undefined,
): Promise<void> {
  params.logger.info(
    {
      evidenceType: "write-mode",
      outcome: "skipped-idempotent",
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      owner: params.mention.owner,
      repoName: params.mention.repo,
      repo: `${params.mention.owner}/${params.mention.repo}`,
      sourcePrNumber: params.mention.prNumber,
      triggerCommentId: params.mention.commentId,
      triggerCommentUrl: params.triggerCommentUrl,
      writeOutputKey: params.writeOutputKey,
      prUrl,
    },
    "Evidence bundle",
  );

  const replyBody = buildAlreadyAppliedReply({ prUrl });
  await params.postMentionReply(replyBody);
}
