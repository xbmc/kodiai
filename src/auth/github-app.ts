import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { Logger } from "pino";
import type { AppConfig } from "../config.ts";

export interface GitHubApp {
  /** Create an Octokit client authenticated as a specific installation. */
  getInstallationOctokit(installationId: number): Promise<Octokit>;
  /** Return the cached app slug (set during initialize). */
  getAppSlug(): string;
  /** Fetch app identity from GitHub API, cache slug. Must be called before other methods. */
  initialize(): Promise<void>;
  /** Check GitHub API connectivity. Caches result for 30 seconds. */
  checkConnectivity(): Promise<boolean>;
  /** Get a raw installation access token for git URL auth. */
  getInstallationToken(installationId: number): Promise<string>;
  /** Resolve installation and default branch for an arbitrary owner/repo. */
  getRepoInstallationContext(owner: string, repo: string): Promise<{ installationId: number; defaultBranch: string } | null>;
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === statusCode;
}

export function createGitHubApp(config: AppConfig, logger: Logger): GitHubApp {
  let appSlug = "";

  // Connectivity check cache (30-second TTL)
  let lastCheckTime = 0;
  let lastCheckResult = false;
  const CONNECTIVITY_CACHE_MS = 30_000;

  // App-level Octokit for non-installation API calls (getAuthenticated, connectivity)
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.githubAppId,
      privateKey: config.githubPrivateKey,
    },
  });

  return {
    async getInstallationOctokit(installationId: number): Promise<Octokit> {
      logger.debug({ installationId }, "Creating installation Octokit client");

      // Create a fresh Octokit per call; auth-app handles token caching internally
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.githubAppId,
          privateKey: config.githubPrivateKey,
          installationId,
        },
      });

      return octokit;
    },

    getAppSlug(): string {
      return appSlug;
    },

    async initialize(): Promise<void> {
      // Authenticate as the app (JWT) and fetch identity
      const response = await appOctokit.rest.apps.getAuthenticated();
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
      // Use createAppAuth directly to get a raw token (not an Octokit client).
      // auth-app internally caches tokens and refreshes before expiry.
      const auth = createAppAuth({
        appId: config.githubAppId,
        privateKey: config.githubPrivateKey,
      });

      const result = await auth({
        type: "installation",
        installationId,
      });

      logger.debug({ installationId }, "Obtained installation token");

      return result.token;
    },

    async getRepoInstallationContext(owner: string, repo: string): Promise<{ installationId: number; defaultBranch: string } | null> {
      try {
        const installationResponse = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
          owner,
          repo,
        });

        const installationId = installationResponse.data.id;
        const installationOctokit = await this.getInstallationOctokit(installationId);
        const repositoryResponse = await installationOctokit.rest.repos.get({ owner, repo });

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
