import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";
import { installOctokitRetry } from "./octokit-retry.ts";

export const DEFAULT_GITHUB_REQUEST_TIMEOUT_MS = 30_000;
const INSTALLATION_OCTOKIT_CACHE_TTL_MS = 55 * 60 * 1000;
const MAX_INSTALLATION_OCTOKIT_CACHE_ENTRIES = 100;

export interface GitHubApp {
  /** Create an Octokit client authenticated as a specific installation. */
  getInstallationOctokit(
    installationId: number,
    options?: { requestTimeoutMs?: number },
  ): Promise<Octokit>;
  /** Return the cached app slug (set during initialize). */
  getAppSlug(): string;
  /** Fetch app identity from GitHub API, cache slug. Must be called before other methods. */
  initialize(options?: { requestTimeoutMs?: number }): Promise<void>;
  /** Check GitHub API connectivity. Caches result for 30 seconds. */
  checkConnectivity(): Promise<boolean>;
  /** Get a raw installation access token for git URL auth. */
  getInstallationToken(installationId: number): Promise<string>;
  /** Resolve installation and default branch for an arbitrary owner/repo. */
  getRepoInstallationContext(
    owner: string,
    repo: string,
    options?: { requestTimeoutMs?: number },
  ): Promise<{ installationId: number; defaultBranch: string } | null>;
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === statusCode;
}

function githubRequestOptions(options?: { requestTimeoutMs?: number }): { request: { timeout: number } } {
  return {
    request: {
      timeout: options?.requestTimeoutMs ?? DEFAULT_GITHUB_REQUEST_TIMEOUT_MS,
    },
  };
}

export function createGitHubApp(config: AppConfig, logger: Logger): GitHubApp {
  let appSlug = "";
  const installationOctokitCache = new Map<string, { octokit: Octokit; cachedAt: number }>();

  // Connectivity check cache (30-second TTL)
  let lastCheckTime = 0;
  let lastCheckResult = false;
  const CONNECTIVITY_CACHE_MS = 30_000;

  // App-level Octokit for non-installation API calls (getAuthenticated, connectivity)
  const appOctokit = installOctokitRetry(new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.githubAppId,
      privateKey: config.githubPrivateKey,
    },
    ...githubRequestOptions(),
  }), logger);
  function installationOctokitCacheKey(
    installationId: number,
    options?: { requestTimeoutMs?: number },
  ): string {
    return `${installationId}:${options?.requestTimeoutMs ?? DEFAULT_GITHUB_REQUEST_TIMEOUT_MS}`;
  }

  function rememberInstallationOctokit(key: string, octokit: Octokit): void {
    if (installationOctokitCache.size >= MAX_INSTALLATION_OCTOKIT_CACHE_ENTRIES) {
      const oldestKey = installationOctokitCache.keys().next().value as string | undefined;
      if (oldestKey) {
        installationOctokitCache.delete(oldestKey);
      }
    }
    installationOctokitCache.set(key, { octokit, cachedAt: Date.now() });
  }

  return {
    async getInstallationOctokit(
      installationId: number,
      options?: { requestTimeoutMs?: number },
    ): Promise<Octokit> {
      const cacheKey = installationOctokitCacheKey(installationId, options);
      const cached = installationOctokitCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < INSTALLATION_OCTOKIT_CACHE_TTL_MS) {
        logger.debug({ installationId }, "Reusing cached installation Octokit client");
        return cached.octokit;
      }
      if (cached) {
        installationOctokitCache.delete(cacheKey);
      }

      logger.debug({ installationId }, "Creating installation Octokit client");

      const octokit = installOctokitRetry(new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.githubAppId,
          privateKey: config.githubPrivateKey,
          installationId,
        },
        ...githubRequestOptions(options),
      }), logger);

      rememberInstallationOctokit(cacheKey, octokit);
      return octokit;
    },

    getAppSlug(): string {
      return appSlug;
    },

    async initialize(options?: { requestTimeoutMs?: number }): Promise<void> {
      // Authenticate as the app (JWT) and fetch identity
      const response = await appOctokit.rest.apps.getAuthenticated(
        options?.requestTimeoutMs
          ? { request: { timeout: options.requestTimeoutMs } }
          : {},
      );
      const data = response.data;
      if (!data) {
        throw new Error("GitHub App getAuthenticated returned no data");
      }
      appSlug = data.slug ?? String(data.id);

      logger.info({ slug: appSlug }, `GitHub App authenticated as ${appSlug}`);

      // Prime connectivity cache on successful init
      lastCheckTime = Date.now();
      lastCheckResult = true;
    },

    async checkConnectivity(): Promise<boolean> {
      const now = Date.now();
      if (now - lastCheckTime < CONNECTIVITY_CACHE_MS) {
        return lastCheckResult;
      }

      try {
        await appOctokit.rest.apps.getAuthenticated();
        lastCheckResult = true;
      } catch {
        lastCheckResult = false;
      }

      lastCheckTime = Date.now();
      return lastCheckResult;
    },

    async getInstallationToken(installationId: number): Promise<string> {
      const octokit = await this.getInstallationOctokit(installationId);
      const result = await octokit.auth({
        type: "installation",
        installationId,
      }) as { token?: string };
      if (!result.token) {
        throw new Error(`GitHub App installation auth returned no token for installation ${installationId}`);
      }

      logger.debug({ installationId }, "Obtained installation token");

      return result.token;
    },

    async getRepoInstallationContext(
      owner: string,
      repo: string,
      options?: { requestTimeoutMs?: number },
    ): Promise<{ installationId: number; defaultBranch: string } | null> {
      try {
        const installationResponse = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
          owner,
          repo,
          ...(options?.requestTimeoutMs
            ? { request: { timeout: options.requestTimeoutMs } }
            : {}),
        });

        const installationId = installationResponse.data.id;
        const installationOctokit = await this.getInstallationOctokit(
          installationId,
          options,
        );
        const repositoryResponse = await installationOctokit.rest.repos.get({
          owner,
          repo,
          ...(options?.requestTimeoutMs
            ? { request: { timeout: options.requestTimeoutMs } }
            : {}),
        });

        const defaultBranch = repositoryResponse.data.default_branch;
        logger.debug({ owner, repo, installationId, defaultBranch }, "Resolved repository installation context");
        return {
          installationId,
          defaultBranch,
        };
      } catch (error) {
        if (hasStatusCode(error, 404)) {
          logger.warn({ owner, repo }, "Repository not installed for this GitHub App");
          return null;
        }

        throw error;
      }
    },
  };
}
