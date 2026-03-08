import type { Logger } from "pino";
import type { BotUserClient } from "../auth/bot-user.ts";

export interface ForkManager {
  /** Ensure a fork of owner/repo exists under the bot user. Returns fork coordinates. Uses in-memory cache. */
  ensureFork(owner: string, repo: string): Promise<{ forkOwner: string; forkRepo: string }>;
  /** Sync fork's default branch with upstream. Throws on conflict so caller can handle. */
  syncFork(forkOwner: string, forkRepo: string, branch: string): Promise<void>;
  /** Delete a branch in the fork. Best-effort, logs but does not throw on failure. */
  deleteForkBranch(forkOwner: string, forkRepo: string, branch: string): Promise<void>;
  /** Get the bot user's PAT for git clone URL auth. */
  getBotPat(): string;
  /** Whether fork-based write mode is available. */
  readonly enabled: boolean;
}

const FORK_POLL_INTERVAL_MS = 2_000;
const FORK_POLL_TIMEOUT_MS = 30_000;

export function createForkManager(botClient: BotUserClient, logger: Logger, botPat?: string): ForkManager {
  if (!botClient.enabled) {
    return {
      enabled: false,
      async ensureFork(): Promise<never> {
        throw new Error("Fork manager is not available. Bot user client is not configured.");
      },
      async syncFork(): Promise<never> {
        throw new Error("Fork manager is not available. Bot user client is not configured.");
      },
      async deleteForkBranch(): Promise<never> {
        throw new Error("Fork manager is not available. Bot user client is not configured.");
      },
      getBotPat(): never {
        throw new Error("Fork manager is not available. Bot user client is not configured.");
      },
    };
  }

  const forkCache = new Map<string, { forkOwner: string; forkRepo: string }>();

  async function waitForForkReady(owner: string, repo: string): Promise<{ forkOwner: string; forkRepo: string }> {
    const deadline = Date.now() + FORK_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const response = await botClient.octokit.rest.repos.get({ owner, repo });
        const parts = response.data.full_name.split("/") as [string, string];
        const [forkOwner, forkRepo] = parts;
        return { forkOwner, forkRepo };
      } catch {
        // Fork not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, FORK_POLL_INTERVAL_MS));
    }

    throw new Error(`Timed out waiting for fork ${owner}/${repo} to become ready after ${FORK_POLL_TIMEOUT_MS}ms`);
  }

  return {
    enabled: true,

    async ensureFork(owner: string, repo: string): Promise<{ forkOwner: string; forkRepo: string }> {
      const cacheKey = `${owner}/${repo}`;
      const cached = forkCache.get(cacheKey);
      if (cached) {
        logger.debug({ owner, repo, cached }, "Fork cache hit");
        return cached;
      }

      // Check if fork already exists
      try {
        const response = await botClient.octokit.rest.repos.get({ owner: botClient.login, repo });
        // Verify it's actually a fork of the expected upstream
        const source = response.data.source;
        if (source && source.full_name === `${owner}/${repo}`) {
          const parts = response.data.full_name.split("/") as [string, string];
          const [forkOwner, forkRepo] = parts;
          const result = { forkOwner, forkRepo };
          forkCache.set(cacheKey, result);
          logger.info({ owner, repo, forkOwner, forkRepo }, "Found existing fork");
          return result;
        }
        // Repo exists but is not a fork of the target -- fall through to create
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
          // Fork doesn't exist, create it
        } else {
          throw error;
        }
      }

      // Create fork
      logger.info({ owner, repo }, "Creating fork");
      try {
        await botClient.octokit.rest.repos.createFork({
          owner,
          repo,
          default_branch_only: true,
        });
      } catch (error: unknown) {
        forkCache.delete(cacheKey);
        throw error;
      }

      // Poll until fork is ready (GitHub creates forks asynchronously)
      const result = await waitForForkReady(botClient.login, repo);
      forkCache.set(cacheKey, result);
      logger.info({ owner, repo, forkOwner: result.forkOwner, forkRepo: result.forkRepo }, "Fork created and ready");
      return result;
    },

    async syncFork(forkOwner: string, forkRepo: string, branch: string): Promise<void> {
      logger.debug({ forkOwner, forkRepo, branch }, "Syncing fork with upstream");
      try {
        await botClient.octokit.request("POST /repos/{owner}/{repo}/merge-upstream", {
          owner: forkOwner,
          repo: forkRepo,
          branch,
        });
        logger.info({ forkOwner, forkRepo, branch }, "Fork synced with upstream");
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 409) {
          throw new Error(
            `Merge conflict syncing fork ${forkOwner}/${forkRepo} branch ${branch} with upstream. A git-based fallback may be needed.`,
          );
        }
        throw error;
      }
    },

    async deleteForkBranch(forkOwner: string, forkRepo: string, branch: string): Promise<void> {
      try {
        await botClient.octokit.rest.git.deleteRef({
          owner: forkOwner,
          repo: forkRepo,
          ref: `heads/${branch}`,
        });
        logger.info({ forkOwner, forkRepo, branch }, "Deleted fork branch");
      } catch (error) {
        logger.warn({ forkOwner, forkRepo, branch, error }, "Failed to delete fork branch (best-effort)");
      }
    },

    getBotPat(): string {
      if (!botPat) {
        throw new Error("Bot PAT not provided to ForkManager");
      }
      return botPat;
    },
  };
}
