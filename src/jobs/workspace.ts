import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { WorkspaceManager, Workspace, CloneOptions } from "./types.ts";

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
function validateBranchName(branchName: string): void {
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

      let token: string;
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
        if (error instanceof Error && token!) {
          error.message = redactToken(error.message, token!);
          if (error.stack) {
            error.stack = redactToken(error.stack, token!);
          }
        }
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
