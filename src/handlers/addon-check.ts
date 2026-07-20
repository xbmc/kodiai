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
  ValidAddonSubmissionBranches,
  type AddonFinding,
} from "../lib/addon-checker-runner.ts";
import {
  classifyAddonCheckOutcome,
} from "../lib/addon-check-classification.ts";
import {
  toProductionLogAddonCheckMode,
  toProductionLogAddonCheckReasonCode,
  toProductionLogAddonCheckFindingSeverity,
} from "../review-audit/production-log-projection.ts";
import {
  buildAddonCheckMarker,
  buildAddonReviewRequestMarker,
  formatAddonCheckComment,
} from "../lib/addon-check-formatter.ts";
import {
  runAddonRuleReview,
  type LoadAddonRuleSource,
  type RunAddonRuleLlm,
} from "../lib/addon-rule-review.ts";
import type { AddonRuleReviewComment } from "../lib/addon-rule-types.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
} from "../jobs/workspace.ts";
import { mapWithConcurrency } from "../lib/concurrency.ts";
import { fetchAllPullRequestFiles } from "../lib/github-pr-files.ts";
import { findIssueCommentByMarkerPaged } from "../lib/github-issue-comments.ts";
import { retryGitHubTransient } from "../lib/github-retry.ts";
import {
  createIssueCommentWithPublicationPipeline,
  updateIssueCommentWithPublicationPipeline,
} from "../lib/github-publication.ts";
import { err as resultErr, ok as resultOk, toError, type Result } from "../lib/result.ts";

// Re-exported so tests can reference the type without importing from runner directly.
export type { AddonFinding };

type RunSubprocess = Parameters<typeof runAddonChecker>[0]["__runSubprocessForTests"];
type FetchAndCheckout = typeof fetchAndCheckoutPullRequestHeadRef;

export type AddonCheckCommentUpsertStatus =
  | { action: "created"; commentId: number }
  | { action: "updated"; commentId: number };

export type AddonCheckCommentUpsertResult = Result<AddonCheckCommentUpsertStatus>;

/** Posts or updates the addon-check PR comment (idempotent). */
export async function upsertAddonCheckComment(params: {
  octokit: {
    rest: {
      issues: {
        listComments: (args: {
          owner: string;
          repo: string;
          issue_number: number;
          per_page: number;
          page: number;
        }) => Promise<{ data: Array<{ id: number; body?: string }> }>;
        createComment: (args: {
          owner: string;
          repo: string;
          issue_number: number;
          body: string;
        }) => Promise<{ data: { id: number } }>;
        updateComment: (args: {
          owner: string;
          repo: string;
          comment_id: number;
          body: string;
        }) => Promise<{ data: { id: number } }>;
      };
    };
  };
  owner: string;
  repo: string;
  prNumber: number;
  marker: string;
  body: string;
  botHandles: string[];
}): Promise<AddonCheckCommentUpsertResult> {
  const { octokit, owner, repo, prNumber, marker, body, botHandles } = params;

  try {
    const status = await retryGitHubTransient(async (): Promise<AddonCheckCommentUpsertStatus> => {
      const existing = await findIssueCommentByMarkerPaged(octokit, {
        owner,
        repo,
        issueNumber: prNumber,
        marker,
      });

      if (existing) {
        const updated = await updateIssueCommentWithPublicationPipeline(octokit as never, {
          owner,
          repo,
          comment_id: existing.id,
          body,
          botHandles,
          preserveKodiaiMarkers: true,
        });
        return { action: "updated", commentId: updated.data.id };
      }

      const created = await createIssueCommentWithPublicationPipeline(octokit as never, {
        owner,
        repo,
        issue_number: prNumber,
        body,
        botHandles,
        preserveKodiaiMarkers: true,
      });
      return { action: "created", commentId: created.data.id };
    });
    return resultOk(status);
  } catch (err) {
    return resultErr(toError(err));
  }
}

export const ADDON_CHECK_RUNNER_TIME_BUDGET_MS = 240_000;
const ADDON_CHECK_CONCURRENCY = 2;

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
  let errorCount = 0;
  let warningCount = 0;
  for (const finding of findings) {
    if (finding.level === "ERROR") errorCount += 1;
    if (finding.level === "WARN") warningCount += 1;
  }
  return { findingCount: findings.length, errorCount, warningCount };
}

export function filterCheckerFindingsToChangedEvidence(
  findings: readonly AddonFinding[],
  files: ReadonlyArray<{ filename: string }>,
): AddonFinding[] {
  const changedPathsByAddon = new Map<string, string[]>();
  for (const file of files) {
    const normalized = file.filename.replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = normalized.indexOf("/");
    if (slash <= 0) continue;
    const addonId = normalized.slice(0, slash);
    const paths = changedPathsByAddon.get(addonId) ?? [];
    paths.push(normalized);
    changedPathsByAddon.set(addonId, paths);
  }

  return findings.filter((finding) => {
    const paths = changedPathsByAddon.get(finding.addonId) ?? [];
    const message = finding.message.toLowerCase();
    for (const path of paths) {
      const relativePath = path.slice(finding.addonId.length + 1).toLowerCase();
      const basename = relativePath.split("/").pop() ?? "";
      if (message.includes(path.toLowerCase()) || message.includes(relativePath)) return true;
      if (basename.length >= 4 && message.includes(basename)) return true;
    }

    return paths.some((path) => path.toLowerCase().endsWith("/addon.xml"))
      && /\b(addon\.xml|manifest|metadata|summary|description|license|version|dependency|extension)\b/i.test(message);
  });
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
  /** Test-only: injected rule source loader. */
  __loadAddonRuleSourceForTests?: LoadAddonRuleSource;
  /** Test-only: injected addon-rule LLM runner. */
  __runAddonRuleLlmForTests?: RunAddonRuleLlm;
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
    __loadAddonRuleSourceForTests,
    __runAddonRuleLlmForTests,
  } = deps;

  const loadRules = __loadAddonRuleSourceForTests;
  const runAddonRuleLlm = __runAddonRuleLlmForTests;

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

      const files = await fetchAllPullRequestFiles({
        octokit,
        owner,
        repo: repoName,
        pullNumber: prNumber,
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

      // Checker execution requires a known Kodi version. The specialized rule
      // review still runs for invalid branches so it can publish the violation.
      const kodiVersion = resolveCheckerBranch(baseBranch);

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

            const shouldRunAddonRuleLlm =
              event.name === "addon_rule_review" || (payload as { action?: string }).action === "opened";
            const allFindings: AddonFinding[] = [];
            const addonSummaries: AddonCheckRuntimeSummary[] = [];
            const timeBudgetMs = __addonCheckTimeBudgetMsForTests ?? ADDON_CHECK_RUNNER_TIME_BUDGET_MS;
            const workspaceDir = workspace.dir;

            const addonResults = kodiVersion === null
              ? []
              : await mapWithConcurrency(addonIds, ADDON_CHECK_CONCURRENCY, async (addonId) => {
                const addonDir = path.join(workspaceDir, addonId);
                const result = await runAddonChecker({
                  addonDir,
                  branch: kodiVersion,
                  timeBudgetMs,
                  __runSubprocessForTests,
                });

                if (result.toolNotFound) {
                  handlerLogger.warn({ addonId }, "addon-check: kodi-addon-checker not installed, skipping");
                  return { summary: { toolNotFound: true } satisfies AddonCheckRuntimeSummary, findings: [] };
                }

                if (result.timedOut) {
                  handlerLogger.info({ timeBudgetMs }, "addon-check: runner skipped after budget");
                  return { summary: { timedOut: true } satisfies AddonCheckRuntimeSummary, findings: [] };
                }

                const findingCounts = countFindings(result.findings);
                const summary = { completed: true, ...findingCounts } satisfies AddonCheckRuntimeSummary;

                for (const finding of result.findings) {
                  handlerLogger.debug(
                    {
                      severity: toProductionLogAddonCheckFindingSeverity(finding.level),
                      message: finding.message,
                    },
                    "addon-check: finding detail",
                  );
                }

                return { summary, findings: result.findings };
              });

            for (const result of addonResults) {
              addonSummaries.push(result.summary);
              allFindings.push(...result.findings);
            }

            const addonRuleReview: AddonRuleReviewComment = await runAddonRuleReview({
              repo,
              prNumber,
              baseBranch,
              validBranches: ValidAddonSubmissionBranches,
              files,
              runLlmReview: shouldRunAddonRuleLlm,
              logger: handlerLogger,
              ...(loadRules ? { loadRules } : {}),
              ...(runAddonRuleLlm ? { runLlm: runAddonRuleLlm } : {}),
            });
            if (kodiVersion === null && !addonRuleReview.incompleteReasons.includes("checker-incomplete")) {
              addonRuleReview.incompleteReasons.push("checker-incomplete");
            }

            const classification = kodiVersion === null
              ? undefined
              : classifyAddonCheckOutcome({
                deliveryId: event.id,
                repo,
                prNumber,
                addons: addonSummaries,
                timeBudgetMs,
              });

            if (classification) {
              handlerLogger.info(
                {
                  gate: classification.gate,
                  gateResult: classification.classification,
                  mode: toProductionLogAddonCheckMode(classification.mode),
                  reasonCodes: classification.reasonCodes.map(toProductionLogAddonCheckReasonCode),
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
            } else {
              handlerLogger.info(
                {
                  gate: "addon-check-branch",
                  gateResult: "skipped",
                  reasonCode: "invalid-target-branch",
                  baseBranch,
                },
                "addon-check: checker skipped for invalid target branch",
              );
            }

            handlerLogger.info(
              { addonIds, totalFindings: allFindings.length },
              "addon-check: complete",
            );

            const marker = event.name === "addon_rule_review"
              ? buildAddonReviewRequestMarker(event.id)
              : buildAddonCheckMarker(owner, repoName, prNumber);
            const publicCheckerFindings = filterCheckerFindingsToChangedEvidence(allFindings, files);
            const body = formatAddonCheckComment(publicCheckerFindings, marker, classification, addonRuleReview);
            const appSlug = typeof githubApp.getAppSlug === "function"
              ? githubApp.getAppSlug()
              : "kodiai";
            const commentUpsert = await upsertAddonCheckComment({
              octokit: octokit as Parameters<typeof upsertAddonCheckComment>[0]["octokit"],
              owner,
              repo: repoName,
              prNumber,
              marker,
              body,
              botHandles: [appSlug, "claude"],
            });
            if (!commentUpsert.ok) {
              throw commentUpsert.err;
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
  eventRouter.register("addon_rule_review.requested", handlePullRequest);
}
