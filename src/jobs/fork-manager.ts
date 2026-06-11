import type { Logger } from "pino";
import type { BotUserClient } from "../auth/bot-user.ts";
import { retryGitHubTransient } from "../lib/github-retry.ts";
import { createInMemoryCache } from "../lib/in-memory-cache.ts";
import { dedupeInflight } from "../lib/inflight-dedupe.ts";

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
const FORK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_FORK_CACHE_ENTRIES = 500;

function summarizeError(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) {
    return {};
  }

  const record = error as Record<string, unknown>;
  return {
    ...(typeof record.name === "string" ? { errorName: record.name } : {}),
    ...(typeof record.status === "number" ? { errorStatus: record.status } : {}),
    ...(typeof record.code === "string" || typeof record.code === "number" ? { errorCode: record.code } : {}),
    ...(typeof record.message === "string" ? { errorMessage: record.message } : {}),
    ...(typeof record.stack === "string" ? { errorStack: record.stack } : {}),
  };
}

function isConflictError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}

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

  const forkCache = createInMemoryCache<string, { forkOwner: string; forkRepo: string }>({
    maxSize: MAX_FORK_CACHE_ENTRIES,
    ttlMs: FORK_CACHE_TTL_MS,
  });
  const inflightEnsureForks = new Map<string, Promise<{ forkOwner: string; forkRepo: string }>>();

  async function waitForForkReady(owner: string, repo: string): Promise<{ forkOwner: string; forkRepo: string }> {
    const deadline = Date.now() + FORK_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const response = await retryGitHubTransient(() =>
          botClient.octokit.rest.repos.get({ owner, repo })
        );
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

  async function loadFork(owner: string, repo: string, cacheKey: string): Promise<{ forkOwner: string; forkRepo: string }> {
    try {
      const response = await retryGitHubTransient(() =>
        botClient.octokit.rest.repos.get({ owner: botClient.login, repo })
      );
      const source = response.data.source;
      if (source && source.full_name === `${owner}/${repo}`) {
        const parts = response.data.full_name.split("/") as [string, string];
        const [forkOwner, forkRepo] = parts;
        const result = { forkOwner, forkRepo };
        forkCache.set(cacheKey, result);
        logger.info({ owner, repo, forkOwner, forkRepo }, "Found existing fork");
        return result;
      }
    } catch (error: unknown) {
      if (typeof error !== "object" || error === null || !("status" in error) || error.status !== 404) {
        throw error;
      }
    }

    logger.info({ owner, repo }, "Creating fork");
    try {
      await retryGitHubTransient(() =>
        botClient.octokit.rest.repos.createFork({
          owner,
          repo,
          default_branch_only: true,
        })
      );
    } catch (error: unknown) {
      forkCache.delete(cacheKey);
      throw error;
    }

    const result = await waitForForkReady(botClient.login, repo);
    forkCache.set(cacheKey, result);
    logger.info({ owner, repo, forkOwner: result.forkOwner, forkRepo: result.forkRepo }, "Fork created and ready");
    return result;
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
      return dedupeInflight(inflightEnsureForks, cacheKey, () => loadFork(owner, repo, cacheKey));
    },

    async syncFork(forkOwner: string, forkRepo: string, branch: string): Promise<void> {
      logger.debug({ forkOwner, forkRepo, branch }, "Syncing fork with upstream");
      try {
        await retryGitHubTransient(() =>
          botClient.octokit.request("POST /repos/{owner}/{repo}/merge-upstream", {
            owner: forkOwner,
            repo: forkRepo,
            branch,
          })
        );
        logger.info({ forkOwner, forkRepo, branch }, "Fork synced with upstream");
      } catch (error: unknown) {
        if (isConflictError(error)) {
          logger.warn({ forkOwner, forkRepo, branch, ...summarizeError(error) }, "Fork sync hit merge conflict");
          throw new Error(
            `Merge conflict syncing fork ${forkOwner}/${forkRepo} branch ${branch} with upstream. A git-based fallback may be needed.`,
          );
        }
        throw error;
      }
    },

    async deleteForkBranch(forkOwner: string, forkRepo: string, branch: string): Promise<void> {
      try {
        await retryGitHubTransient(() =>
          botClient.octokit.rest.git.deleteRef({
            owner: forkOwner,
            repo: forkRepo,
            ref: `heads/${branch}`,
          })
        );
        logger.info({ forkOwner, forkRepo, branch }, "Deleted fork branch");
      } catch (error) {
        logger.warn(
          { forkOwner, forkRepo, branch, ...summarizeError(error) },
          "Failed to delete fork branch (best-effort)",
        );
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
