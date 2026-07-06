import type { Logger } from "pino";
import { $ } from "bun";
import type { Workspace } from "../jobs/types.ts";
import type { ReviewWorkCoordinator } from "../jobs/review-work-coordinator.ts";
import { loadRepoConfig } from "../execution/config.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
  fetchRemoteTrackingBranch,
} from "../jobs/workspace.ts";
import { runCommandWithCappedOutput, type CappedProcessResult } from "../lib/capped-process.ts";
import { splitGitLines } from "../lib/review-git-utils.ts";
import type { MentionEvent } from "./mention-types.ts";

const GIST_PATCH_MAX_BYTES = 2 * 1024 * 1024;
const PR_DIFF_MAX_CHARS = 8_000;

export async function prepareMentionCheckoutAndLoadConfig(params: {
  workspace: Workspace;
  usesPrRef: boolean;
  mention: Pick<MentionEvent, "prNumber" | "baseRef">;
  cloneDepth: number;
}): Promise<Awaited<ReturnType<typeof loadRepoConfig>>> {
  const trustedBaseRepoConfig = params.usesPrRef
    ? await loadRepoConfig(params.workspace.dir)
    : null;

  if (params.usesPrRef && params.mention.prNumber !== undefined) {
    await fetchAndCheckoutPullRequestHeadRef({
      dir: params.workspace.dir,
      prNumber: params.mention.prNumber,
      localBranch: "pr-mention",
      token: params.workspace.token,
      depth: params.cloneDepth,
    });

    if (params.mention.baseRef) {
      await fetchRemoteTrackingBranch({
        dir: params.workspace.dir,
        branch: params.mention.baseRef,
        token: params.workspace.token,
        depth: params.cloneDepth,
      });
    }
  }

  return trustedBaseRepoConfig ?? loadRepoConfig(params.workspace.dir);
}

export async function collectMentionDiffFilePaths(params: {
  workspaceDir: string;
  baseRef: string;
}): Promise<CappedProcessResult> {
  let diffResult = await runCommandWithCappedOutput({
    command: "git",
    args: ["diff", `origin/${params.baseRef}...HEAD`, "--name-only"],
    cwd: params.workspaceDir,
    maxStdoutBytes: 256 * 1024,
  });
  if (diffResult.exitCode !== 0) {
    diffResult = await runCommandWithCappedOutput({
      command: "git",
      args: ["diff", `origin/${params.baseRef}..HEAD`, "--name-only"],
      cwd: params.workspaceDir,
      maxStdoutBytes: 256 * 1024,
    });
  }
  return diffResult;
}

export async function collectCappedPrDiff(params: {
  workspaceDir: string;
  baseRef: string;
  logger: Logger;
  logContext: Record<string, unknown>;
}): Promise<{ stat: string; diff: string; truncated: boolean; fileCount: number } | undefined> {
  let statResult = await $`git -C ${params.workspaceDir} diff origin/${params.baseRef}...HEAD --stat`.quiet().nothrow();
  let diffResult = await runCommandWithCappedOutput({
    command: "git",
    args: ["diff", `origin/${params.baseRef}...HEAD`],
    cwd: params.workspaceDir,
    maxStdoutBytes: PR_DIFF_MAX_CHARS + 4096,
  });
  if (statResult.exitCode !== 0 || diffResult.exitCode !== 0) {
    params.logger.debug(
      {
        ...params.logContext,
        statExitCode: statResult.exitCode,
        diffExitCode: diffResult.exitCode,
      },
      "Three-dot diff failed, falling back to two-dot diff",
    );
    statResult = await $`git -C ${params.workspaceDir} diff origin/${params.baseRef}..HEAD --stat`.quiet().nothrow();
    diffResult = await runCommandWithCappedOutput({
      command: "git",
      args: ["diff", `origin/${params.baseRef}..HEAD`],
      cwd: params.workspaceDir,
      maxStdoutBytes: PR_DIFF_MAX_CHARS + 4096,
    });
  }

  if (statResult.exitCode !== 0 || (diffResult.exitCode !== 0 && !diffResult.stdoutTruncated)) {
    return undefined;
  }

  const stat = statResult.text().trim();
  const fullDiff = diffResult.stdout;
  const truncated = diffResult.stdoutTruncated || fullDiff.length > PR_DIFF_MAX_CHARS;
  const cutPoint = fullDiff.lastIndexOf("\n", PR_DIFF_MAX_CHARS);
  const diff = truncated
    ? fullDiff.slice(0, cutPoint > 0 ? cutPoint : PR_DIFF_MAX_CHARS)
    : fullDiff.trim();
  const fileCount = stat.split("\n").filter((line) => line.includes("|")).length;
  return { stat, diff, truncated, fileCount };
}

export async function collectWorkspaceChangedFiles(workspaceDir: string): Promise<string[]> {
  const changedFilesRaw = (await $`git -C ${workspaceDir} diff --name-only HEAD`.quiet().nothrow()).text().trim();
  const stagedFilesRaw = (await $`git -C ${workspaceDir} diff --cached --name-only`.quiet().nothrow()).text().trim();
  const allChangedRaw = [changedFilesRaw, stagedFilesRaw].filter(Boolean).join("\n");
  return [...new Set(splitGitLines(allChangedRaw))];
}

export async function buildStagedPatchForGist(workspaceDir: string): Promise<CappedProcessResult> {
  await $`git -C ${workspaceDir} add -A`.quiet();
  return runCommandWithCappedOutput({
    command: "git",
    args: ["diff", "--cached"],
    cwd: workspaceDir,
    maxStdoutBytes: GIST_PATCH_MAX_BYTES,
  });
}

export function buildMentionQueueKey(owner: string, repo: string, issueOrPrNumber: number): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}#${issueOrPrNumber}`;
}

export function findLatestReviewPredecessor(
  snapshot: ReturnType<ReviewWorkCoordinator["getSnapshot"]>,
  currentAttemptId: string,
) {
  if (!snapshot) {
    return null;
  }

  return snapshot.attempts
    .filter((attempt) => attempt.attemptId !== currentAttemptId)
    .sort((left, right) => {
      if (right.lastProgressAtMs !== left.lastProgressAtMs) {
        return right.lastProgressAtMs - left.lastProgressAtMs;
      }
      return right.claimedAtMs - left.claimedAtMs;
    })[0] ?? null;
}
