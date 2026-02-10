import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { WorkspaceManager, Workspace, CloneOptions } from "./types.ts";

export class WritePolicyError extends Error {
  readonly code:
    | "write-policy-denied-path"
    | "write-policy-not-allowed"
    | "write-policy-secret-detected"
    | "write-policy-no-changes";

  constructor(
    code: WritePolicyError["code"],
    message: string,
  ) {
    super(message);
    this.name = "WritePolicyError";
    this.code = code;
  }
}

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

  // After first character, allow alphanumeric, underscore, slash, dot, dash
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_/.\-]*$/.test(branchName)) {
    throw new Error(
      `Branch name contains invalid characters (allowed: alphanumeric, _, /, ., -): ${branchName}`,
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

async function getOriginTokenFromRemoteUrl(dir: string): Promise<string | undefined> {
  try {
    const url = (await $`git -C ${dir} remote get-url origin`.quiet()).text().trim();
    const match = url.match(/https:\/\/x-access-token:([^@]+)@github\.com(?:\/|$)/);
    return match?.[1];
  } catch {
    return undefined;
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

function pathMatchesPattern(path: string, pattern: string): boolean {
  // Keep patterns intentionally simple and deterministic:
  // - "dir/" => prefix match
  // - "*.ext" => suffix match
  // - "foo" => exact match or path endsWith("/foo")
  const p = pattern.trim();
  if (p.length === 0) return false;

  if (p.endsWith("/")) {
    return path.startsWith(p);
  }
  if (p.startsWith("*.") && p.length > 2) {
    return path.endsWith(p.slice(1));
  }
  return path === p || path.endsWith(`/${p}`);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => pathMatchesPattern(path, p));
}

function buildSecretRegexes(): Array<{ name: string; regex: RegExp }> {
  return [
    { name: "private-key", regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/ },
    { name: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/ },
    { name: "github-pat", regex: /ghp_[A-Za-z0-9]{36}/ },
    { name: "slack-token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
    { name: "github-x-access-token-url", regex: /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/ },
  ];
}

async function enforceWritePolicy(options: {
  dir: string;
  stagedPaths: string[];
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
}): Promise<void> {
  const { dir, stagedPaths, allowPaths, denyPaths, secretScanEnabled } = options;

  for (const path of stagedPaths) {
    if (matchesAny(path, denyPaths)) {
      throw new WritePolicyError(
        "write-policy-denied-path",
        `Write blocked: denied path staged: ${path}`,
      );
    }
  }

  if (allowPaths.length > 0) {
    for (const path of stagedPaths) {
      if (!matchesAny(path, allowPaths)) {
        throw new WritePolicyError(
          "write-policy-not-allowed",
          `Write blocked: path is not allowlisted: ${path}`,
        );
      }
    }
  }

  if (secretScanEnabled) {
    const diff = (await $`git -C ${dir} diff --cached`.quiet()).text();
    for (const { name, regex } of buildSecretRegexes()) {
      if (regex.test(diff)) {
        throw new WritePolicyError(
          "write-policy-secret-detected",
          `Write blocked: suspected secret detected (${name}) in staged diff`,
        );
      }
    }
  }
}

export async function createBranchCommitAndPush(options: {
  dir: string;
  branchName: string;
  commitMessage: string;
  remote?: string;
  policy?: {
    allowPaths?: string[];
    denyPaths?: string[];
    secretScanEnabled?: boolean;
  };
}): Promise<{ branchName: string; headSha: string }> {
  const { dir, branchName, commitMessage, remote = "origin" } = options;

  validateBranchName(branchName);

  const token = await getOriginTokenFromRemoteUrl(dir);

  try {
    await $`git -C ${dir} checkout -b ${branchName}`.quiet();
    await $`git -C ${dir} add -A`.quiet();

    // Ensure there is something to commit.
    const staged = (await $`git -C ${dir} diff --cached --name-only`.quiet()).text().trim();
    if (staged.length === 0) {
      throw new WritePolicyError("write-policy-no-changes", "No staged changes to commit");
    }

    const stagedPaths = staged.split("\n").map((s) => s.trim()).filter(Boolean);
    await enforceWritePolicy({
      dir,
      stagedPaths,
      allowPaths: options.policy?.allowPaths ?? [],
      denyPaths: options.policy?.denyPaths ?? [],
      secretScanEnabled: options.policy?.secretScanEnabled ?? true,
    });

    await $`git -C ${dir} commit -m ${commitMessage}`.quiet();
    const headSha = (await $`git -C ${dir} rev-parse HEAD`.quiet()).text().trim();
    await $`git -C ${dir} push ${remote} HEAD:${branchName}`.quiet();

    return { branchName, headSha };
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
}): Promise<{ localBranch: string }> {
  const { dir, prNumber, remote = "origin", localBranch = "pr-review" } = options;

  validatePullRequestNumber(prNumber);
  validateBranchName(localBranch);

  const token = await getOriginTokenFromRemoteUrl(dir);
  try {
    await $`git -C ${dir} fetch ${remote} pull/${prNumber}/head:${localBranch}`.quiet();
    await $`git -C ${dir} checkout ${localBranch}`.quiet();
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }

  return { localBranch };
}

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

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
      const { owner, repo, ref, depth = 1 } = options;

      // Validate branch name before creating any resources
      validateBranchName(ref);

      // Create temp directory
      const dir = await mkdtemp(join(tmpdir(), "kodiai-"));

      let token: string | undefined;
      try {
        // Get installation token for clone auth
        token = await githubApp.getInstallationToken(installationId);

        // Build authenticated clone URL -- NEVER log this
        const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

        // Shallow clone the specific branch
        await $`git clone --depth=${depth} --single-branch --branch ${ref} ${cloneUrl} ${dir}`.quiet();

        // Configure git identity as kodiai[bot]
        await $`git -C ${dir} config user.name "kodiai[bot]"`;
        await $`git -C ${dir} config user.email "kodiai[bot]@users.noreply.github.com"`;
      } catch (error: unknown) {
        // Clean up temp dir on failure; never mask the original error
        await rm(dir, { recursive: true, force: true }).catch(() => {});

        // Redact token from error messages to prevent leakage
        redactTokenFromError(error, token);
        throw error;
      }

      logger.info({ owner, repo, ref, dir }, "Workspace created");

      const cleanup = async (): Promise<void> => {
        await rm(dir, { recursive: true, force: true });
        logger.debug({ dir }, "Workspace cleaned up");
      };

      return { dir, cleanup };
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
