/**
 * Handler for pull_request.opened and pull_request.synchronize webhook events.
 *
 * Gates on config.addonRepos: only fires for repositories listed there.
 * Extracts addon IDs from PR file paths (first path segment of files with a
 * directory component) and logs them for downstream use.
 *
 * This is a scaffold handler — it logs what it would check without taking action.
 */

import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { AppConfig } from "../config.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

export function createAddonCheckHandler(deps: {
  eventRouter: EventRouter;
  githubApp: GitHubApp;
  config: AppConfig;
  logger: Logger;
}): void {
  const { eventRouter, githubApp, config, logger } = deps;

  async function handlePullRequest(event: WebhookEvent): Promise<void> {
    const payload = event.payload as {
      pull_request?: { number: number };
      repository?: {
        full_name: string;
        name: string;
        owner?: { login: string };
      };
    };

    const repo = payload.repository?.full_name;
    const owner = payload.repository?.owner?.login;
    const repoName = payload.repository?.name;
    const prNumber = payload.pull_request?.number;

    if (!repo || !owner || !repoName || prNumber == null) {
      logger.debug({ deliveryId: event.id }, "addon-check: missing repo or PR number in payload");
      return;
    }

    const handlerLogger = logger.child({
      handler: "addon-check",
      repo,
      prNumber,
      deliveryId: event.id,
    });

    // Gate: only process repos in config.addonRepos
    if (!config.addonRepos.includes(repo)) {
      handlerLogger.debug("addon-check: repo not in addonRepos, skipping");
      return;
    }

    try {
      const octokit = await githubApp.getInstallationOctokit(event.installationId);

      const { data: files } = await octokit.rest.pulls.listFiles({
        owner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100,
      });

      // Extract unique, sorted addon IDs from file paths.
      // Files at the repo root (no slash) are excluded — they don't belong to any addon.
      const addonIds = [
        ...new Set(
          files
            .filter((f) => f.filename.includes("/"))
            .map((f) => f.filename.split("/")[0]!),
        ),
      ].sort();

      handlerLogger.info({ addonIds, prNumber, repo }, "Addon check: would check addons");
    } catch (err) {
      logger.error(
        { err, deliveryId: event.id, repo, prNumber },
        "Addon check handler failed (non-fatal)",
      );
    }
  }

  eventRouter.register("pull_request.opened", handlePullRequest);
  eventRouter.register("pull_request.synchronize", handlePullRequest);
}
