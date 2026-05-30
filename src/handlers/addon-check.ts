/**
 * Handler for pull_request.opened and pull_request.synchronize webhook events.
 *
 * Gates on config.addonRepos: only fires for repositories listed there.
 * Extracts addon IDs from PR file paths, resolves the Kodi branch, clones the
 * workspace, and runs kodi-addon-checker per addon, returning structured findings.
 * Posts or updates a PR comment with the aggregated findings.
 */

import path from "node:path";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { AppConfig } from "../config.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { WorkspaceManager, JobQueue } from "../jobs/types.ts";
import {
  runAddonChecker,
  resolveCheckerBranch,
  type AddonFinding,
} from "../lib/addon-checker-runner.ts";
import {
  classifyAddonCheckOutcome,
  type AddonCheckClassificationMode,
  type AddonCheckReasonCode,
} from "../lib/addon-check-classification.ts";
import {
  buildAddonCheckMarker,
  formatAddonCheckComment,
} from "../lib/addon-check-formatter.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
} from "../jobs/workspace.ts";

// Re-exported so tests can reference the type without importing from runner directly.
export type { AddonFinding };

type RunSubprocess = Parameters<typeof runAddonChecker>[0]["__runSubprocessForTests"];
type FetchAndCheckout = typeof fetchAndCheckoutPullRequestHeadRef;

/** Posts or updates the addon-check PR comment (idempotent). */
async function upsertAddonCheckComment(params: {
  octokit: {
    rest: {
      issues: {
        listComments: (args: {
          owner: string;
          repo: string;
          issue_number: number;
          per_page: number;
        }) => Promise<{ data: Array<{ id: number; body?: string }> }>;
        createComment: (args: {
          owner: string;
          repo: string;
          issue_number: number;
          body: string;
        }) => Promise<unknown>;
        updateComment: (args: {
          owner: string;
          repo: string;
          comment_id: number;
          body: string;
        }) => Promise<unknown>;
      };
    };
  };
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}): Promise<void> {
  const { octokit, owner, repo, prNumber, body } = params;
  const marker = buildAddonCheckMarker(owner, repo, prNumber);

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

export const ADDON_CHECK_RUNNER_TIME_BUDGET_MS = 240_000;

type AddonCheckRuntimeSummary = {
  completed?: true;
  timedOut?: true;
  toolNotFound?: true;
  findingCount?: number;
  errorCount?: number;
  warningCount?: number;
};

function countFindings(findings: AddonFinding[]): {
  findingCount: number;
  errorCount: number;
  warningCount: number;
} {
  return {
    findingCount: findings.length,
    errorCount: findings.filter((finding) => finding.level === "ERROR").length,
    warningCount: findings.filter((finding) => finding.level === "WARN").length,
  };
}

const ADDON_CHECK_PRODUCTION_LOG_MODE_ALIASES = {
  "all-timeout": "all-budget-exhausted",
  "partial-timeout": "partial-budget-exhausted",
} satisfies Partial<Record<AddonCheckClassificationMode, string>>;

const ADDON_CHECK_PRODUCTION_LOG_REASON_ALIASES = {
  "all-timeout": "all-budget-exhausted",
  "partial-timeout": "partial-budget-exhausted",
} satisfies Partial<Record<AddonCheckReasonCode, string>>;

function toAddonCheckProductionLogMode(mode: AddonCheckClassificationMode): string {
  return ADDON_CHECK_PRODUCTION_LOG_MODE_ALIASES[mode] ?? mode;
}

function toAddonCheckProductionLogReasonCode(reasonCode: AddonCheckReasonCode): string {
  return ADDON_CHECK_PRODUCTION_LOG_REASON_ALIASES[reasonCode] ?? reasonCode;
}

export function createAddonCheckHandler(deps: {
  eventRouter: EventRouter;
  githubApp: GitHubApp;
  config: AppConfig;
  logger: Logger;
  workspaceManager: WorkspaceManager;
  jobQueue: JobQueue;
  /** Test-only: injected subprocess stub forwarded to runAddonChecker. */
  __runSubprocessForTests?: RunSubprocess;
  /** Test-only: override the checker time budget for deterministic timeout tests. */
  __addonCheckTimeBudgetMsForTests?: number;
  /** Test-only: injected fetch-and-checkout stub for fork PR path. */
  __fetchAndCheckoutForTests?: FetchAndCheckout;
}): void {
  const {
    eventRouter,
    githubApp,
    config,
    logger,
    workspaceManager,
    jobQueue,
    __runSubprocessForTests,
    __fetchAndCheckoutForTests,
    __addonCheckTimeBudgetMsForTests,
  } = deps;

  async function handlePullRequest(event: WebhookEvent): Promise<void> {
    const payload = event.payload as {
      pull_request?: {
        number: number;
        base: { ref: string };
        head: { ref: string; repo: { full_name: string } | null };
      };
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

      const baseBranch = payload.pull_request!.base.ref;
      const headRef = payload.pull_request!.head.ref;
      const headRepo = payload.pull_request!.head.repo;

      // Resolve Kodi version from base branch name. Unknown branches are skipped.
      const kodiVersion = resolveCheckerBranch(baseBranch);
      if (kodiVersion === null) {
        handlerLogger.warn({ baseBranch }, "addon-check: unknown kodi branch, skipping");
        return;
      }

      // If no addons changed, nothing to check.
      if (addonIds.length === 0) {
        handlerLogger.info({ addonIds, prNumber, repo }, "addon-check: complete");
        return;
      }

      // Fork detection: head.repo is null for deleted forks.
      const isFork = Boolean(headRepo && headRepo.full_name !== repo);
      const isDeletedFork = !headRepo;

      await jobQueue.enqueue(
        event.installationId,
        async () => {
          let workspace: Awaited<ReturnType<WorkspaceManager["create"]>> | null = null;
          try {
            if (isFork || isDeletedFork) {
              // Fork PRs: clone base branch, then fetch PR head ref from upstream.
              // Avoids requiring access to the contributor's fork.
              workspace = await workspaceManager.create(event.installationId, {
                owner,
                repo: repoName,
                ref: baseBranch,
              });
              const fetchAndCheckout = __fetchAndCheckoutForTests ?? fetchAndCheckoutPullRequestHeadRef;
              await fetchAndCheckout({ dir: workspace.dir, prNumber, localBranch: "pr-check" });
            } else {
              // Non-fork: clone head branch directly.
              workspace = await workspaceManager.create(event.installationId, {
                owner,
                repo: repoName,
                ref: headRef,
              });
            }

            const allFindings: AddonFinding[] = [];
            const addonSummaries: AddonCheckRuntimeSummary[] = [];
            const timeBudgetMs = __addonCheckTimeBudgetMsForTests ?? ADDON_CHECK_RUNNER_TIME_BUDGET_MS;

            for (const addonId of addonIds) {
              const addonDir = path.join(workspace.dir, addonId);
              const result = await runAddonChecker({
                addonDir,
                branch: kodiVersion,
                timeBudgetMs,
                __runSubprocessForTests,
              });

              if (result.toolNotFound) {
                handlerLogger.warn({ addonId }, "addon-check: kodi-addon-checker not installed, skipping");
                addonSummaries.push({ toolNotFound: true });
                continue;
              }

              if (result.timedOut) {
                handlerLogger.info({ addonId, timeBudgetMs }, "addon-check: runner skipped after budget");
                addonSummaries.push({ timedOut: true });
                continue;
              }

              const findingCounts = countFindings(result.findings);
              addonSummaries.push({ completed: true, ...findingCounts });

              for (const finding of result.findings) {
                handlerLogger.info(
                  { addonId: finding.addonId, findingLevel: finding.level, message: finding.message },
                  "addon-check: finding",
                );
                allFindings.push(finding);
              }
            }

            const classification = classifyAddonCheckOutcome({
              deliveryId: event.id,
              repo,
              prNumber,
              addons: addonSummaries,
              timeBudgetMs,
            });

            handlerLogger.info(
              {
                gate: classification.gate,
                gateResult: classification.classification,
                classification: classification.classification,
                mode: toAddonCheckProductionLogMode(classification.mode),
                reasonCodes: classification.reasonCodes.map(toAddonCheckProductionLogReasonCode),
                actionableDiagnostic: classification.actionableDiagnostic,
                expectedBoundedOutcome: classification.expectedBoundedOutcome,
                addonCount: classification.counts.addonCount,
                completedCount: classification.counts.completedCount,
                boundedIncompleteCount: classification.counts.timedOutCount,
                toolNotFoundCount: classification.counts.toolNotFoundCount,
                findingCount: classification.counts.findingCount,
                severeFindingCount: classification.counts.errorCount,
                advisoryFindingCount: classification.counts.warningCount,
                budgetMs: classification.counts.timeBudgetMs,
                redaction: classification.redaction,
                deliveryId: event.id,
                repo,
                prNumber,
              },
              "addon-check: classification",
            );

            handlerLogger.info(
              { addonIds, totalFindings: allFindings.length },
              "addon-check: complete",
            );

            // Skip comment entirely when every addon returned toolNotFound
            // (kodi-addon-checker not installed on this runner).
            if (allFindings.length === 0 && classification.mode === "tool-unavailable") {
              handlerLogger.warn("addon-check: all addons returned toolNotFound, skipping comment");
            } else {
              const marker = buildAddonCheckMarker(owner, repoName, prNumber);
              const body = formatAddonCheckComment(allFindings, marker, classification);
              await upsertAddonCheckComment({
                octokit: octokit as Parameters<typeof upsertAddonCheckComment>[0]["octokit"],
                owner,
                repo: repoName,
                prNumber,
                body,
              });
            }
          } finally {
            await workspace?.cleanup();
          }
        },
        {
          deliveryId: event.id,
          eventName: "pull_request",
          lane: "sync",
          key: `${repo.trim().toLowerCase()}#${prNumber}`,
          jobType: "addon-check",
          prNumber,
        },
      );
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
