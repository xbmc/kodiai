import type { Logger } from "pino";
import {
  assertOriginIsFork as defaultAssertOriginIsFork,
  createBranchCommitAndPush as defaultCreateBranchCommitAndPush,
  shouldUseGist as defaultShouldUseGist,
  WritePolicyError,
} from "../jobs/workspace.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import { ok, type Result } from "../lib/result.ts";
import { buildWritePolicyRefusalMessage } from "../lib/write-policy-formatting.ts";
import { summarizeWriteRequest } from "../lib/write-request-formatting.ts";
import { buildMentionWriteCommitMessage } from "./mention-write-formatters.ts";
import {
  buildEmptyPatchReply,
  buildFallbackPatchGistReply,
  buildIssueWriteSuccessReply,
  buildPatchGistReply,
  buildPatchTooLargeReply,
  buildWritePolicyRefusalReply,
} from "./mention-write-replies.ts";
import {
  buildMentionWritePullRequestDraft as defaultBuildMentionWritePullRequestDraft,
  type MentionWritePullRequestDraft,
} from "./mention-write-pr-draft.ts";
import {
  publishMentionWritePullRequest as defaultPublishMentionWritePullRequest,
  type MentionWritePullRequestPublicationResult,
} from "./mention-write-pr-publication.ts";
import {
  buildStagedPatchForGist as defaultBuildStagedPatchForGist,
  collectWorkspaceChangedFiles as defaultCollectWorkspaceChangedFiles,
} from "./mention-workspace.ts";

type ForkWriteMention = {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber?: number;
  baseRef?: string;
  issueTitle: string | null;
};

type ForkContext = {
  forkOwner: string;
  forkRepo: string;
  botPat: string;
};

type WritePolicy = {
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
};

type PostMentionReply = (
  body: string,
  options?: { sanitizeMentions?: boolean },
) => Promise<void>;

type PatchResult = {
  stdout: string;
  stdoutTruncated: boolean;
};

type PublishMentionWritePullRequest = (params: {
  octokit: unknown;
  owner: string;
  repo: string;
  draft: MentionWritePullRequestDraft;
  head: string;
  base: string;
  botHandles: string[];
}) => Promise<MentionWritePullRequestPublicationResult>;

export type ForkWriteOutputStatus = {
  status: "handled" | "fall-through";
};

export async function publishMentionForkWriteOutput(params: {
  workspaceDir: string;
  octokit: unknown;
  mention: ForkWriteMention;
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
  botHandles: string[];
  logger: Logger;
  postMentionReply: PostMentionReply;
  collectWorkspaceChangedFiles?: (workspaceDir: string) => Promise<string[]>;
  shouldUseGist?: (input: { keyword: string }, changedFiles: string[]) => boolean;
  buildStagedPatchForGist?: (workspaceDir: string) => Promise<PatchResult>;
  assertOriginIsFork?: (workspaceDir: string, forkOwner: string) => Promise<void>;
  createBranchCommitAndPush?: (input: {
    dir: string;
    branchName: string;
    commitMessage: string;
    policy: WritePolicy;
    token?: string;
  }) => Promise<{ branchName: string; headSha: string }>;
  buildMentionWritePullRequestDraft?: typeof defaultBuildMentionWritePullRequestDraft;
  publishMentionWritePullRequest?: PublishMentionWritePullRequest;
  recordWriteRateLimitSuccess: (owner: string, repo: string) => void;
}): Promise<Result<ForkWriteOutputStatus>> {
  if (!params.forkContext || !params.gistPublisher?.enabled) {
    return ok({ status: "fall-through" });
  }

  const collectWorkspaceChangedFiles = params.collectWorkspaceChangedFiles ?? defaultCollectWorkspaceChangedFiles;
  const shouldUseGist = params.shouldUseGist ?? defaultShouldUseGist;
  const buildStagedPatchForGist = params.buildStagedPatchForGist ?? defaultBuildStagedPatchForGist;
  const assertOriginIsFork = params.assertOriginIsFork ?? (
    (workspaceDir, forkOwner) => defaultAssertOriginIsFork(workspaceDir, forkOwner)
  );
  const createBranchCommitAndPush = params.createBranchCommitAndPush ?? defaultCreateBranchCommitAndPush;
  const buildMentionWritePullRequestDraft =
    params.buildMentionWritePullRequestDraft ?? defaultBuildMentionWritePullRequestDraft;
  const publishMentionWritePullRequest =
    params.publishMentionWritePullRequest ?? (
      defaultPublishMentionWritePullRequest as unknown as PublishMentionWritePullRequest
    );

  const changedFiles = await collectWorkspaceChangedFiles(params.workspaceDir);
  const useGist = shouldUseGist({ keyword: params.writeKeyword }, changedFiles);

  if (useGist) {
    try {
      const handled = await publishPrimaryGist({
        ...params,
        gistPublisher: params.gistPublisher,
        changedFiles,
        buildStagedPatchForGist,
      });
      if (handled) return ok({ status: "handled" });
    } catch (gistErr) {
      params.logger.warn(
        { err: gistErr, owner: params.mention.owner, repo: params.mention.repo },
        "Gist creation failed; falling through to PR path",
      );
    }
  }

  try {
    await assertOriginIsFork(params.workspaceDir, params.forkContext.forkOwner);

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

    const pushed = await createBranchCommitAndPush({
      dir: params.workspaceDir,
      branchName: params.writeBranchName,
      commitMessage,
      policy: {
        allowPaths: params.allowPaths,
        denyPaths: params.denyPaths,
        secretScanEnabled: params.secretScanEnabled,
      },
      token: params.forkContext.botPat,
    });

    const crossForkHead = `${params.forkContext.forkOwner}:${pushed.branchName}`;
    const prBaseRef = params.mention.prNumber !== undefined ? (params.mention.baseRef ?? "main") : (params.cloneRef ?? "main");

    const prDraft = await buildMentionWritePullRequestDraft({
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

    const response = await publishMentionWritePullRequest({
      octokit: params.octokit,
      owner: params.mention.owner,
      repo: params.mention.repo,
      draft: prDraft,
      head: crossForkHead,
      base: prBaseRef,
      botHandles: params.botHandles,
    });
    if (!response.ok) {
      throw response.err;
    }

    const createdPrUrl = response.value.data.html_url;
    const issueLinkbackUrl =
      params.mention.prNumber !== undefined
        ? `https://github.com/${params.mention.owner}/${params.mention.repo}/pull/${params.mention.prNumber}`
        : `https://github.com/${params.mention.owner}/${params.mention.repo}/issues/${params.mention.issueNumber}`;

    const replyBody = buildIssueWriteSuccessReply({
      prUrl: createdPrUrl,
      issueLinkbackUrl,
    });
    await params.postMentionReply(replyBody);

    params.logger.info(
      {
        evidenceType: "write-mode",
        outcome: "created-cross-fork-pr",
        deliveryId: params.deliveryId,
        installationId: params.installationId,
        owner: params.mention.owner,
        repoName: params.mention.repo,
        repo: `${params.mention.owner}/${params.mention.repo}`,
        forkOwner: params.forkContext.forkOwner,
        crossForkHead,
        prUrl: createdPrUrl,
        commitSha: pushed.headSha,
        writeOutputKey: params.writeOutputKey,
        triggerCommentUrl: params.triggerCommentUrl,
      },
      "Evidence bundle",
    );
    return ok({ status: "handled" });
  } catch (forkPrErr) {
    params.logger.warn(
      { err: forkPrErr, owner: params.mention.owner, repo: params.mention.repo },
      "Fork-based PR creation failed; falling back to gist",
    );

    if (forkPrErr instanceof WritePolicyError) {
      const refusal = buildWritePolicyRefusalMessage(forkPrErr, params.allowPaths);
      const replyBody = buildWritePolicyRefusalReply({ refusal });
      await params.postMentionReply(replyBody);
      return ok({ status: "handled" });
    }

    try {
      const patchResult = await buildStagedPatchForGist(params.workspaceDir);
      const patch = patchResult.stdout;
      if (patchResult.stdoutTruncated) {
        throw new Error("Generated patch exceeds gist publication limit");
      }
      if (patch.trim().length > 0) {
        const requestSummary = summarizeWriteRequest(params.writeRequest);
        const gist = await params.gistPublisher.createPatchGist({
          owner: params.mention.owner,
          repo: params.mention.repo,
          summary: requestSummary,
          patch,
        });

        const gistReplyBody = buildFallbackPatchGistReply({ gistUrl: gist.htmlUrl });
        await params.postMentionReply(gistReplyBody);

        params.logger.info(
          {
            evidenceType: "write-mode",
            outcome: "fallback-gist",
            deliveryId: params.deliveryId,
            owner: params.mention.owner,
            repo: `${params.mention.owner}/${params.mention.repo}`,
            gistUrl: gist.htmlUrl,
            writeOutputKey: params.writeOutputKey,
          },
          "Evidence bundle",
        );
        params.recordWriteRateLimitSuccess(params.mention.owner, params.mention.repo);
        return ok({ status: "handled" });
      }
    } catch (fallbackErr) {
      params.logger.error(
        { err: fallbackErr },
        "Fallback gist creation also failed",
      );
    }
  }

  params.logger.warn(
    { owner: params.mention.owner, repo: params.mention.repo },
    "Fork-based write mode failed completely; falling through to legacy direct-push path",
  );
  return ok({ status: "fall-through" });
}

async function publishPrimaryGist(params: {
  mention: ForkWriteMention;
  gistPublisher: Pick<GistPublisher, "createPatchGist">;
  workspaceDir: string;
  writeRequest: string;
  changedFiles: string[];
  writeOutputKey: string;
  triggerCommentUrl: string;
  deliveryId: string;
  installationId: number;
  logger: Logger;
  postMentionReply: PostMentionReply;
  buildStagedPatchForGist: (workspaceDir: string) => Promise<PatchResult>;
  recordWriteRateLimitSuccess: (owner: string, repo: string) => void;
}): Promise<boolean> {
  const patchResult = await params.buildStagedPatchForGist(params.workspaceDir);
  const patch = patchResult.stdout;

  if (patch.trim().length === 0) {
    const replyBody = buildEmptyPatchReply();
    await params.postMentionReply(replyBody);
    return true;
  }
  if (patchResult.stdoutTruncated) {
    const replyBody = buildPatchTooLargeReply();
    await params.postMentionReply(replyBody);
    return true;
  }

  const requestSummary = summarizeWriteRequest(params.writeRequest);
  const gist = await params.gistPublisher.createPatchGist({
    owner: params.mention.owner,
    repo: params.mention.repo,
    summary: requestSummary,
    patch,
  });

  const gistReplyBody = buildPatchGistReply({
    gistUrl: gist.htmlUrl,
    changedFiles: params.changedFiles,
  });
  await params.postMentionReply(gistReplyBody);

  params.logger.info(
    {
      evidenceType: "write-mode",
      outcome: "created-gist",
      deliveryId: params.deliveryId,
      installationId: params.installationId,
      owner: params.mention.owner,
      repoName: params.mention.repo,
      repo: `${params.mention.owner}/${params.mention.repo}`,
      gistUrl: gist.htmlUrl,
      gistId: gist.id,
      changedFiles: params.changedFiles,
      writeOutputKey: params.writeOutputKey,
      triggerCommentUrl: params.triggerCommentUrl,
    },
    "Evidence bundle",
  );
  params.recordWriteRateLimitSuccess(params.mention.owner, params.mention.repo);
  return true;
}
