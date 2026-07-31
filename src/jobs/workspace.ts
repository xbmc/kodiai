import { mkdtemp, rm, readdir, stat, mkdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import {
  runCommandWithCappedOutput,
  type CappedProcessResult,
} from "../lib/capped-process.ts";
import { WritePolicyError } from "../lib/write-policy-error.ts";
import type { WorkspaceManager, Workspace, CloneOptions } from "./types.ts";
import {
  captureStagedSnapshot,
  commitStagedSnapshot,
  enforceWritePolicy,
  getBoundedStagedPaths,
} from "./workspace-write-policy.ts";

export { WritePolicyError } from "../lib/write-policy-error.ts";
export {
  captureStagedSnapshot,
  commitStagedSnapshot,
  enforceWritePolicy,
  getBoundedStagedPaths,
  STAGED_SECRET_SCAN_MAX_BYTES,
  STAGED_PATHS_MAX_BYTES,
  STAGED_PATHS_MAX_FILES,
  STAGED_GIT_TIMEOUT_MS,
  STAGED_GIT_CONTROL_MAX_BYTES,
} from "./workspace-write-policy.ts";

/**
 * Replace all occurrences of a token in a string with [REDACTED].
 * Prevents token leakage in error messages and stack traces.
 */
function redactToken(message: string, token: string): string {
  return message.replaceAll(token, "[REDACTED]");
}

/**
 * Validate a git branch name to prevent injection attacks and invalid refs.
 * Throws a descriptive Error if the branch name is invalid.
 */
export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim().length === 0) {
    throw new Error("Branch name must not be empty or whitespace-only");
  }

  if (branchName.startsWith("-")) {
    throw new Error(
      `Branch name must not start with '-' (git option injection risk): ${branchName}`,
    );
  }

  // Reject control characters
  if (/[\x00-\x1F\x7F]/.test(branchName)) {
    throw new Error(
      `Branch name must not contain control characters: ${branchName}`,
    );
  }

  // Reject special git characters: ~ ^ : ? * [ ] backslash
  if (/[~^:?*[\]\\]/.test(branchName)) {
    throw new Error(
      `Branch name must not contain special git characters (~, ^, :, ?, *, [, ], \\): ${branchName}`,
    );
  }

  // Must start with alphanumeric
  if (!/^[a-zA-Z0-9]/.test(branchName)) {
    throw new Error(
      `Branch name must start with an alphanumeric character: ${branchName}`,
    );
  }

  // After first character, allow alphanumeric, underscore, slash, dot, dash, and @.
  // GitHub branch refs can legitimately contain @ (for example addon@matrix),
  // while the explicit '@{' guard below still rejects reflog syntax.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_/.\-@]*$/.test(branchName)) {
    throw new Error(
      `Branch name contains invalid characters (allowed: alphanumeric, _, /, ., -, @): ${branchName}`,
    );
  }

  // Reject parent traversal
  if (branchName.includes("..")) {
    throw new Error(
      `Branch name must not contain '..' (parent traversal): ${branchName}`,
    );
  }

  // Reject .lock suffix
  if (branchName.endsWith(".lock")) {
    throw new Error(
      `Branch name must not end with '.lock': ${branchName}`,
    );
  }

  // Reject reflog syntax
  if (branchName.includes("@{")) {
    throw new Error(
      `Branch name must not contain '@{' (reflog syntax): ${branchName}`,
    );
  }

  // Reject trailing slash
  if (branchName.endsWith("/")) {
    throw new Error(
      `Branch name must not end with '/': ${branchName}`,
    );
  }

  // Reject consecutive slashes
  if (branchName.includes("//")) {
    throw new Error(
      `Branch name must not contain consecutive slashes '//': ${branchName}`,
    );
  }
}

export function buildImmutablePushRefspec(commitOid: string, destination: string): string {
  const destinationRef = destination.startsWith("refs/")
    ? destination
    : `refs/heads/${destination}`;
  return `${commitOid}:${destinationRef}`;
}

/**
 * Given a stripped (no-credential) remote URL and an optional token, return the
 * auth-injected URL for use in a single git command.  If token is absent, the
 * stripped URL is returned unchanged so the caller can still attempt anonymous
 * or pre-configured-credential access.
 */
function makeAuthUrl(strippedUrl: string, token: string | undefined): string {
  if (!token) return strippedUrl;
  return strippedUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

const GIT_NETWORK_TIMEOUT_MS = 120_000;

async function runGitNetworkCommand(options: {
  args: string[];
  cwd?: string;
  token?: string;
  allowFailure?: boolean;
  operation: string;
}): Promise<CappedProcessResult> {
  const result = await runCommandWithCappedOutput({
    command: "git",
    args: options.args,
    cwd: options.cwd,
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });

  if (result.exitCode !== 0 && !options.allowFailure) {
    const stderr = result.stderr.trim();
    const suffix = result.timedOut
      ? ` timed out after ${GIT_NETWORK_TIMEOUT_MS}ms`
      : stderr
        ? ` failed: ${stderr}`
        : ` failed with exit code ${result.exitCode}`;
    const err = new Error(`git ${options.operation}${suffix}`);
    redactTokenFromError(err, options.token);
    throw err;
  }

  return result;
}

/**
 * Read the stripped origin remote URL from `dir` and inject `token` into it so
 * it can be used as an ephemeral fetch remote.  Returns `'origin'` when token
 * is absent so the caller can pass the result directly as the remote argument
 * without special-casing.
 */
export async function buildAuthFetchUrl(dir: string, token: string | undefined): Promise<string> {
  if (!token) return "origin";
  const url = (await $`git -C ${dir} remote get-url origin`.quiet()).text().trim();
  return makeAuthUrl(url, token);
}

/**
 * Fetch a branch into its remote-tracking ref, force-updating the local tracking
 * ref when the remote branch was rewound or the workspace has stale state.
 *
 * Git refuses non-fast-forward updates to refs/remotes/* unless the refspec is
 * force-prefixed. Kodiai workspaces are ephemeral review/checkouts, so the
 * remote-tracking ref should mirror the remote exactly instead of failing the
 * review when a base branch moves backwards between clone and refresh.
 */
export async function fetchRemoteTrackingBranch(options: {
  dir: string;
  branch: string;
  remoteName?: string;
  token?: string;
  depth?: number;
}): Promise<void> {
  const { dir, branch, remoteName = "origin", token, depth = 1 } = options;
  validateBranchName(branch);
  validateBranchName(remoteName);

  try {
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remoteName}`.quiet()).text().trim();
    const fetchUrl = makeAuthUrl(strippedUrl, token);
    await runGitNetworkCommand({
      args: ["fetch", fetchUrl, `+${branch}:refs/remotes/${remoteName}/${branch}`, `--depth=${depth}`],
      cwd: dir,
      token,
      operation: "fetch",
    });
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

function redactTokenFromError(err: unknown, token: string | undefined): void {
  if (!(err instanceof Error)) return;

  // Prefer exact token replacement when known.
  if (token) {
    err.message = redactToken(err.message, token);
    if (err.stack) err.stack = redactToken(err.stack, token);
  }

  // Defense-in-depth: redact any x-access-token URLs even if we could not
  // parse the specific token from the origin remote.
  err.message = err.message.replace(
    /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/g,
    (_m, suffix: string) => `https://x-access-token:[REDACTED]@github.com${suffix ?? ""}`,
  );
  if (err.stack) {
    err.stack = err.stack.replace(
      /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/g,
      (_m, suffix: string) => `https://x-access-token:[REDACTED]@github.com${suffix ?? ""}`,
    );
  }
}

export async function getGitStatusPorcelain(dir: string): Promise<string> {
  return (await $`git -C ${dir} status --porcelain`.quiet()).text();
}
export async function createBranchCommitAndPush(options: {
  dir: string;
  branchName: string;
  commitMessage: string;
  remote?: string;
  token?: string;
  policy?: {
    allowPaths?: string[];
    denyPaths?: string[];
    secretScanEnabled?: boolean;
  };
}): Promise<{ branchName: string; headSha: string }> {
  const { dir, branchName, commitMessage, remote = "origin", token } = options;

  validateBranchName(branchName);

  try {
    await $`git -C ${dir} checkout -b ${branchName}`.quiet();
    await $`git -C ${dir} add -A`.quiet();

    // Ensure there is something to commit.
    const snapshot = await captureStagedSnapshot({ dir });
    const stagedPaths = await getBoundedStagedPaths({ dir, ...snapshot });
    if (stagedPaths.length === 0) {
      throw new WritePolicyError("write-policy-no-changes", "No staged changes to commit");
    }

    await enforceWritePolicy({
      dir,
      ...snapshot,
      stagedPaths,
      allowPaths: options.policy?.allowPaths ?? [],
      denyPaths: options.policy?.denyPaths ?? [],
      secretScanEnabled: options.policy?.secretScanEnabled ?? true,
    });

    const headSha = await commitStagedSnapshot({ dir, ...snapshot, commitMessage });

    // Construct the auth URL inline; never stored — used for this push only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const pushUrl = makeAuthUrl(strippedUrl, token);
    await runGitNetworkCommand({
      args: ["push", pushUrl, buildImmutablePushRefspec(headSha, branchName)],
      cwd: dir,
      token,
      operation: "push",
    });

    return { branchName, headSha };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

export async function commitAndPushToRemoteRef(options: {
  dir: string;
  remoteRef: string;
  commitMessage: string;
  remote?: string;
  token?: string;
  policy?: {
    allowPaths?: string[];
    denyPaths?: string[];
    secretScanEnabled?: boolean;
  };
}): Promise<{ remoteRef: string; headSha: string }> {
  const { dir, remoteRef, commitMessage, remote = "origin", token } = options;

  validateBranchName(remoteRef);

  try {
    await $`git -C ${dir} add -A`.quiet();

    const snapshot = await captureStagedSnapshot({ dir });
    const stagedPaths = await getBoundedStagedPaths({ dir, ...snapshot });
    if (stagedPaths.length === 0) {
      throw new WritePolicyError("write-policy-no-changes", "No staged changes to commit");
    }

    await enforceWritePolicy({
      dir,
      ...snapshot,
      stagedPaths,
      allowPaths: options.policy?.allowPaths ?? [],
      denyPaths: options.policy?.denyPaths ?? [],
      secretScanEnabled: options.policy?.secretScanEnabled ?? true,
    });

    const headSha = await commitStagedSnapshot({ dir, ...snapshot, commitMessage });

    // Construct the auth URL inline; never stored — used for this push only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const pushUrl = makeAuthUrl(strippedUrl, token);
    await runGitNetworkCommand({
      args: ["push", pushUrl, buildImmutablePushRefspec(headSha, remoteRef)],
      cwd: dir,
      token,
      operation: "push",
    });

    return { remoteRef, headSha };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

export async function pushHeadToRemoteRef(options: {
  dir: string;
  remoteRef: string;
  remote?: string;
  token?: string;
}): Promise<{ remoteRef: string; headSha: string }> {
  const { dir, remoteRef, remote = "origin", token } = options;
  validateBranchName(remoteRef);

  try {
    const headSha = (await $`git -C ${dir} rev-parse HEAD`.quiet()).text().trim();

    // Construct the auth URL inline; never stored — used for this push only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const pushUrl = makeAuthUrl(strippedUrl, token);
    await runGitNetworkCommand({
      args: ["push", pushUrl, buildImmutablePushRefspec(headSha, remoteRef)],
      cwd: dir,
      token,
      operation: "push",
    });

    return { remoteRef, headSha };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

function validatePullRequestNumber(prNumber: number): void {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`PR number must be a positive integer: ${prNumber}`);
  }
}

/**
 * In GitHub, pull request head refs are exposed on the base repo as:
 *   refs/pull/<PR_NUMBER>/head
 *
 * Fetching and checking out that ref allows reviewing fork PRs without cloning the fork.
 */
export async function fetchAndCheckoutPullRequestHeadRef(options: {
  dir: string;
  prNumber: number;
  remote?: string;
  localBranch?: string;
  token?: string;
  fallbackRemoteUrl?: string;
  fallbackRef?: string;
  depth?: number;
}): Promise<{ localBranch: string; source: "pull-ref" | "head-ref-fallback" }> {
  const { dir, prNumber, remote = "origin", localBranch = "pr-review", token, fallbackRemoteUrl, fallbackRef, depth } = options;

  validatePullRequestNumber(prNumber);
  validateBranchName(localBranch);
  if (fallbackRef) validateBranchName(fallbackRef);

  try {
    // Construct the auth URL inline; never stored — used for this fetch only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const fetchUrl = makeAuthUrl(strippedUrl, token);
    const primaryFetchArgs = depth === undefined
      ? ["fetch", fetchUrl, `pull/${prNumber}/head:${localBranch}`]
      : ["fetch", fetchUrl, `pull/${prNumber}/head:${localBranch}`, `--depth=${depth}`];
    const primaryFetch = await runGitNetworkCommand({
      args: primaryFetchArgs,
      cwd: dir,
      token,
      allowFailure: true,
      operation: "fetch",
    });
    if (primaryFetch.exitCode === 0) {
      await $`git -C ${dir} checkout ${localBranch}`.quiet();
      return { localBranch, source: "pull-ref" };
    }

    const stderr = primaryFetch.stderr;
    const missingPullRef = stderr.includes(`couldn't find remote ref pull/${prNumber}/head`)
      || stderr.includes(`couldn't find remote ref refs/pull/${prNumber}/head`);
    if (!missingPullRef || !fallbackRemoteUrl || !fallbackRef) {
      const err = new Error(`git fetch pull/${prNumber}/head failed: ${stderr.trim()}`);
      redactTokenFromError(err, token);
      throw err;
    }

    const fallbackFetchUrl = makeAuthUrl(fallbackRemoteUrl, token);
    const fallbackFetchArgs = depth === undefined
      ? ["fetch", fallbackFetchUrl, `${fallbackRef}:${localBranch}`]
      : ["fetch", fallbackFetchUrl, `${fallbackRef}:${localBranch}`, `--depth=${depth}`];
    await runGitNetworkCommand({
      args: fallbackFetchArgs,
      cwd: dir,
      token,
      operation: "fetch",
    });
    await $`git -C ${dir} checkout ${localBranch}`.quiet();
    return { localBranch, source: "head-ref-fallback" };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
export const AZURE_FILES_WORKSPACE_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function cleanupStaleAzureFilesWorkspaceDirs(opts: {
  mountBase: string;
  staleThresholdMs?: number;
  nowMs?: number;
  logger?: Logger;
}): Promise<number> {
  const staleThresholdMs = opts.staleThresholdMs ?? AZURE_FILES_WORKSPACE_STALE_THRESHOLD_MS;
  const nowMs = opts.nowMs ?? Date.now();
  let entries: Dirent[];

  try {
    entries = await readdir(opts.mountBase, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return 0;
    }
    opts.logger?.warn(
      { err: error instanceof Error ? error.message : String(error), mountBase: opts.mountBase },
      "Failed to list Azure Files workspaces for stale cleanup",
    );
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = join(opts.mountBase, entry.name);
    try {
      const stats = await stat(fullPath);
      if (nowMs - stats.mtimeMs <= staleThresholdMs) continue;
      await rm(fullPath, { recursive: true, force: true });
      removed++;
    } catch (error: unknown) {
      opts.logger?.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          dir: fullPath,
        },
        "Failed to clean up stale Azure Files workspace",
      );
    }
  }

  return removed;
}

/**
 * Create a workspace manager that handles ephemeral git workspace lifecycle:
 * clone with token auth, bot identity config, cleanup, and stale dir removal.
 */
export function createWorkspaceManager(
  githubApp: GitHubApp,
  logger: Logger,
): WorkspaceManager {
  return {
    async create(
      installationId: number,
      options: CloneOptions,
    ): Promise<Workspace> {
      const { owner, repo, ref, depth = 1, forkContext } = options;

      // Validate branch name before creating any resources
      validateBranchName(ref);

      // Create temp directory
      const dir = await mkdtemp(join(tmpdir(), "kodiai-"));

      let token: string | undefined;
      try {
        // Get installation token (always needed for upstream remote)
        token = await githubApp.getInstallationToken(installationId);

        if (forkContext) {
          // Fork-aware clone: clone from the bot-owned fork using bot PAT
          const forkCloneUrl = `https://x-access-token:${forkContext.botPat}@github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git`;
          await runGitNetworkCommand({
            args: ["clone", `--depth=${depth}`, "--single-branch", "--branch", ref, forkCloneUrl, dir],
            token: forkContext.botPat,
            operation: "clone",
          });

          // Add upstream remote pointing at the original repo (using installation token)
          const upstreamUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
          await $`git -C ${dir} remote add upstream ${upstreamUrl}`.quiet();

          // Strip credentials from remotes immediately — token stays in memory only
          await $`git -C ${dir} remote set-url origin https://github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git`.quiet();
          await $`git -C ${dir} remote set-url upstream https://github.com/${owner}/${repo}.git`.quiet();
        } else {
          // Standard clone from target repo using installation token
          const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
          await runGitNetworkCommand({
            args: ["clone", `--depth=${depth}`, "--single-branch", "--branch", ref, cloneUrl, dir],
            token,
            operation: "clone",
          });

          // Strip credentials from remote immediately — token stays in memory only
          await $`git -C ${dir} remote set-url origin https://github.com/${owner}/${repo}.git`.quiet();
        }

        // Configure git identity as kodiai[bot]
        await $`git -C ${dir} config user.name "kodiai[bot]"`;
        await $`git -C ${dir} config user.email "kodiai[bot]@users.noreply.github.com"`;
      } catch (error: unknown) {
        // Clean up temp dir on failure; never mask the original error
        await rm(dir, { recursive: true, force: true }).catch((cleanupError: unknown) => {
          logger.warn(
            {
              err: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              dir,
            },
            "Failed to clean up workspace after clone failure",
          );
        });

        // Redact token from error messages to prevent leakage
        redactTokenFromError(error, token);
        throw error;
      }

      logger.info({ owner, repo, ref, dir, fork: !!forkContext }, "Workspace created");

      const cleanup = async (): Promise<void> => {
        try {
          await rm(dir, { recursive: true, force: true });
          logger.debug({ dir }, "Workspace cleaned up");
        } catch (cleanupError: unknown) {
          logger.warn(
            {
              err: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              dir,
            },
            "Failed to clean up workspace (idempotent, never throws -- directory may still contain a credential and needs manual removal)",
          );
        }
      };

      return { dir, cleanup, token };
    },

    async cleanupStale(): Promise<number> {
      try {
        const tmpDir = tmpdir();
        const entries = await readdir(tmpDir);
        const now = Date.now();
        let removed = 0;

        for (const entry of entries) {
          if (!entry.startsWith("kodiai-")) continue;

          const fullPath = join(tmpDir, entry);
          try {
            const stats = await stat(fullPath);
            if (now - stats.mtimeMs > STALE_THRESHOLD_MS) {
              await rm(fullPath, { recursive: true, force: true });
              removed++;
            }
          } catch {
            // Individual entry stat/rm failure is non-fatal; skip it
          }
        }

        if (removed > 0) {
          logger.info({ removed }, "Stale workspaces cleaned up");
        }

        return removed;
      } catch (error: unknown) {
        logger.warn(
          { err: error },
          "Failed to clean up stale workspaces (non-fatal)",
        );
        return 0;
      }
    },
  };
}

/**
 * Verify that origin points to the expected fork, not the upstream repo.
 * Throws if mismatch -- prevents accidental direct pushes to target repos.
 */
export async function assertOriginIsFork(dir: string, expectedForkOwner: string): Promise<void> {
  const url = (await $`git -C ${dir} remote get-url origin`.quiet()).text().trim();
  if (!url.toLowerCase().includes(`github.com/${expectedForkOwner.toLowerCase()}/`)) {
    throw new Error(
      `Push guard: origin remote points to "${url}" which does not belong to fork owner "${expectedForkOwner}". ` +
      `Direct pushes to target repos are prevented. Clone from the fork instead.`,
    );
  }
}

/**
 * Determine whether to output a gist (patch) vs a PR based on user intent and change scope.
 *
 * Routing logic:
 * - Explicit "patch" keyword -> gist
 * - Explicit "pr" keyword -> PR
 * - Single file change -> gist
 * - More than 3 files -> PR
 * - 2-3 files in same directory -> gist, else PR
 */
export function shouldUseGist(intent: { keyword?: string }, changedFiles: string[]): boolean {
  if (intent.keyword === "patch") return true;
  if (intent.keyword === "pr") return false;

  if (changedFiles.length === 0) return true; // no changes = gist (empty patch)
  if (changedFiles.length === 1) return true;
  if (changedFiles.length > 3) return false;

  // 2-3 files: check if all in same directory
  const dirs = new Set(changedFiles.map((f) => dirname(f)));
  return dirs.size === 1;
}

/**
 * Create an Azure Files-backed workspace directory for a single ACA Job execution.
 * Returns the absolute path to the created directory.
 *
 * The mount base is the path where the Azure Files share is mounted inside the
 * orchestrator container (e.g. `/mnt/kodiai-workspaces`). Each job gets its own
 * subdirectory keyed by jobId so concurrent jobs don't share state.
 */
export async function createAzureFilesWorkspaceDir(opts: {
  mountBase: string;
  jobId: string;
}): Promise<string> {
  const dir = join(opts.mountBase, opts.jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}
