import type { CheckSuiteCompletedEvent } from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import { recordCheckRuns, getFlakiness } from "../lib/ci-check-store.ts";
import {
  classifyFailures,
  type CheckResult,
} from "../lib/ci-failure-classifier.ts";
import {
  formatCISection,
  buildCIAnalysisMarker,
} from "../lib/ci-failure-formatter.ts";

/**
 * Create and register the CI failure analysis handler.
 *
 * Listens for check_suite.completed events and posts/updates a CI analysis
 * comment on associated PRs when failures are detected.
 *
 * Completely independent of the review pipeline — does not modify merge
 * confidence or block approval.
 */
export function createCIFailureHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  sql: Sql;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, githubApp, sql, logger } = deps;

  async function handleCheckSuiteCompleted(
    event: WebhookEvent,
  ): Promise<void> {
    const payload = event.payload as unknown as CheckSuiteCompletedEvent;
    const checkSuite = payload.check_suite;
    const headSha = checkSuite.head_sha;
    const owner = payload.repository?.owner?.login;
    const repoName = payload.repository?.name;

    if (!owner || !repoName) return;

    const pullRequests = checkSuite.pull_requests;
    if (!pullRequests || pullRequests.length === 0) {
      logger.debug(
        { deliveryId: event.id, headSha },
        "No PRs in check_suite (fork?)",
      );
      return;
    }

    const fullRepo = `${owner}/${repoName}`;

    await jobQueue.enqueue(
      event.installationId,
      async () => {
        try {
          const octokit = await githubApp.getInstallationOctokit(
            event.installationId,
          );

          // Fetch ALL check runs for the head SHA (paginated)
          const headChecks: CheckResult[] = [];
          try {
            for await (const response of octokit.paginate.iterator(
              octokit.rest.checks.listForRef,
              {
                owner,
                repo: repoName,
                ref: headSha,
                per_page: 100,
                filter: "latest",
              },
            )) {
              for (const run of response.data) {
                headChecks.push({
                  name: run.name,
                  conclusion: run.conclusion ?? null,
                  status: run.status,
                });
              }
            }
          } catch (err: unknown) {
            const status =
              typeof err === "object" && err !== null && "status" in err
                ? (err as { status: number }).status
                : 0;
            if (status === 403) {
              logger.warn(
                { deliveryId: event.id, owner, repo: repoName },
                "checks:read permission may be missing",
              );
              return;
            }
            throw err;
          }

          // Record all check runs for flakiness tracking
          const runsToRecord = headChecks
            .filter((c) => c.conclusion !== null)
            .map((c) => ({
              name: c.name,
              conclusion: c.conclusion!,
            }));

          // Process each PR in the check_suite
          for (const pr of pullRequests) {
            const prNumber = pr.number;
            const baseRef = (pr as { base?: { ref?: string } }).base?.ref;

            await recordCheckRuns(sql, {
              repo: fullRepo,
              headSha,
              prNumber,
              checkSuiteId: checkSuite.id,
              runs: runsToRecord,
            });

            // Filter to failures
            const failures = headChecks.filter(
              (c) => c.conclusion === "failure",
            );

            if (failures.length === 0) {
              logger.debug(
                { deliveryId: event.id, prNumber, headSha },
                "All checks pass, skipping CI annotation",
              );
              continue;
            }

            if (!baseRef) {
              logger.debug(
                { deliveryId: event.id, prNumber },
                "No base ref available, skipping CI annotation",
              );
              continue;
            }

            // Fetch last 3 commits on base branch
            let baseCommits: Array<{ sha: string }>;
            try {
              const { data: commits } = await octokit.rest.repos.listCommits({
                owner,
                repo: repoName,
                sha: baseRef,
                per_page: 3,
              });
              baseCommits = commits.map((c) => ({ sha: c.sha }));
            } catch {
              logger.debug(
                { deliveryId: event.id, baseRef },
                "Failed to fetch base branch commits, skipping CI annotation",
              );
              continue;
            }

            // Fetch check runs for each base commit (sequentially to reduce burst)
            const baseResults = new Map<string, CheckResult[]>();
            let anyBaseData = false;

            for (const commit of baseCommits) {
              try {
                const baseChecks: CheckResult[] = [];
                for await (const response of octokit.paginate.iterator(
                  octokit.rest.checks.listForRef,
                  {
                    owner,
                    repo: repoName,
                    ref: commit.sha,
                    per_page: 100,
                    filter: "latest",
                  },
                )) {
                  for (const run of response.data) {
                    baseChecks.push({
                      name: run.name,
                      conclusion: run.conclusion ?? null,
                      status: run.status,
                    });
                  }
                }
                if (baseChecks.length > 0) {
                  baseResults.set(commit.sha, baseChecks);
                  anyBaseData = true;
                }
              } catch {
                // Treat as empty results for this ref
                logger.debug(
                  { deliveryId: event.id, sha: commit.sha },
                  "Failed to fetch checks for base commit",
                );
              }
            }

            // If no base-branch check data exists, skip CI annotation entirely
            if (!anyBaseData) {
              logger.debug(
                { deliveryId: event.id, prNumber },
                "No base-branch check data, skipping CI annotation",
              );
              continue;
            }

            // Get flakiness stats for failed check names
            const failedCheckNames = failures.map((f) => f.name);
            const flakiness = await getFlakiness(sql, {
              repo: fullRepo,
              checkNames: failedCheckNames,
            });

            // Classify failures
            const classified = classifyFailures({
              headChecks,
              baseResults,
              flakiness,
            });

            if (classified.length === 0) continue;

            // Format CI section
            const section = formatCISection(classified, failures.length);
            const marker = buildCIAnalysisMarker(owner, repoName, prNumber);
            const commentBody = `${marker}\n${section}`;

            // Upsert CI comment: find existing by marker, update or create
            await upsertCIComment(octokit, {
              owner,
              repo: repoName,
              prNumber,
              marker,
              body: commentBody,
              logger,
              deliveryId: event.id,
            });
          }
        } catch (err) {
          logger.warn(
            { err, deliveryId: event.id },
            "CI failure analysis error (fail-open)",
          );
        }
      },
      {
        deliveryId: event.id,
        eventName: "check_suite",
        action: "completed",
        jobType: "ci-failure-analysis",
      },
    );
  }

  eventRouter.register("check_suite.completed", handleCheckSuiteCompleted);
}

/**
 * Find an existing CI analysis comment by marker and update it,
 * or create a new one if not found.
 */
async function upsertCIComment(
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>,
  params: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
    body: string;
    logger: Logger;
    deliveryId: string;
  },
): Promise<void> {
  const { owner, repo, prNumber, marker, body, logger, deliveryId } = params;

  // Scan existing comments for the marker
  let existingCommentId: number | null = null;

  try {
    for (let page = 1; page <= 10; page++) {
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
        page,
        sort: "created",
        direction: "desc",
      });

      if (comments.length === 0) break;

      for (const comment of comments) {
        if (comment.body?.includes(marker)) {
          existingCommentId = comment.id;
          break;
        }
      }

      if (existingCommentId !== null) break;
      if (comments.length < 100) break;
    }
  } catch {
    logger.debug(
      { deliveryId, prNumber },
      "Failed to scan for existing CI comment, will create new",
    );
  }

  if (existingCommentId !== null) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingCommentId,
      body,
    });
    logger.debug(
      { deliveryId, prNumber, commentId: existingCommentId },
      "Updated existing CI analysis comment",
    );
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    logger.debug(
      { deliveryId, prNumber },
      "Created new CI analysis comment",
    );
  }
}
