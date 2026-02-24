import type { PullRequestClosedEvent } from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import {
  classifyDepBump,
  detectDepBump,
  extractDepBumpDetails,
  type DepBumpContext,
} from "../lib/dep-bump-detector.ts";
import { fetchChangelog, fetchSecurityAdvisories } from "../lib/dep-bump-enrichment.ts";
import { computeMergeConfidence } from "../lib/merge-confidence.ts";

type AdvisorySeverity = "critical" | "high" | "medium" | "low" | "unknown";

function getMaxAdvisorySeverity(severities: string[]): AdvisorySeverity {
  const order: Record<AdvisorySeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    unknown: 0,
  };

  let max: AdvisorySeverity = "unknown";
  let maxOrder = 0;
  for (const raw of severities) {
    const sev = (raw ?? "").trim().toLowerCase() as AdvisorySeverity;
    const sevOrder = order[sev] ?? 0;
    if (sevOrder > maxOrder) {
      maxOrder = sevOrder;
      max = sev;
    }
  }
  return max;
}

export function createDepBumpMergeHistoryHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  knowledgeStore?: KnowledgeStore;
  logger: Logger;
}): void {
  const { eventRouter, jobQueue, githubApp, knowledgeStore, logger } = deps;

  async function handlePullRequestClosed(event: WebhookEvent): Promise<void> {
    if (!knowledgeStore) return;

    const payload = event.payload as unknown as PullRequestClosedEvent;
    const pr = payload.pull_request;

    if (!pr?.merged) {
      return;
    }

    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    if (!owner || !repo) {
      return;
    }

    await jobQueue.enqueue(event.installationId, async () => {
      const baseLog = {
        deliveryId: event.id,
        installationId: event.installationId,
        action: payload.action,
        prNumber: pr.number,
        owner,
        repo,
      };

      try {
        const octokit = await githubApp.getInstallationOctokit(event.installationId);

        const prLabels = (pr.labels as Array<{ name?: string }> | undefined)
          ?.map((l) => l.name)
          .filter((l): l is string => typeof l === "string") ?? [];

        const detection = detectDepBump({
          prTitle: pr.title ?? "",
          prLabels,
          headBranch: pr.head?.ref ?? "",
          senderLogin: pr.user?.login ?? "unknown",
        });

        if (!detection) {
          return;
        }

        let changedFiles: string[] = [];
        try {
          const resp = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          });
          changedFiles = resp.data
            .map((f) => f.filename)
            .filter((f): f is string => typeof f === "string");
        } catch (err) {
          logger.warn({ ...baseLog, err }, "Dep bump merge-history listFiles failed; continuing");
        }

        const details = extractDepBumpDetails({
          detection,
          prTitle: pr.title ?? "",
          prBody: pr.body ?? null,
          changedFiles,
          headBranch: pr.head?.ref ?? "",
        });

        const classification = classifyDepBump({
          oldVersion: details.oldVersion,
          newVersion: details.newVersion,
        });

        const ctx: DepBumpContext = {
          detection,
          details,
          classification,
        };

        if (details.packageName && details.ecosystem) {
          const [sec, clog] = await Promise.allSettled([
            fetchSecurityAdvisories({
              packageName: details.packageName,
              ecosystem: details.ecosystem,
              oldVersion: details.oldVersion,
              newVersion: details.newVersion,
              octokit,
            }),
            fetchChangelog({
              packageName: details.packageName,
              ecosystem: details.ecosystem,
              oldVersion: details.oldVersion,
              newVersion: details.newVersion,
              octokit,
            }),
          ]);

          ctx.security = sec.status === "fulfilled" ? sec.value : null;
          ctx.changelog = clog.status === "fulfilled" ? clog.value : null;
        }

        const securityContext = ctx.security;
        const advisoryCount = securityContext?.advisories?.length;

        const advisoryStatus =
          advisoryCount === undefined
            ? "unknown"
            : advisoryCount > 0
              ? "present"
              : "none";

        const advisoryMaxSeverity = advisoryCount && advisoryCount > 0
          ? getMaxAdvisorySeverity(securityContext!.advisories.map((a) => a.severity))
          : null;

        ctx.mergeConfidence = computeMergeConfidence(ctx);

        await knowledgeStore.recordDepBumpMergeHistory({
          repo: `${owner}/${repo}`,
          prNumber: pr.number,
          mergedAt: pr.merged_at ?? null,
          deliveryId: event.id,
          source: detection.source,
          signalsJson: JSON.stringify(detection.signals),
          packageName: details.packageName,
          oldVersion: details.oldVersion,
          newVersion: details.newVersion,
          semverBumpType: classification.bumpType,
          mergeConfidenceLevel: ctx.mergeConfidence.level,
          mergeConfidenceRationaleJson: JSON.stringify(ctx.mergeConfidence.rationale),
          advisoryStatus,
          advisoryMaxSeverity,
          isSecurityBump: securityContext?.isSecurityBump ?? null,
        });
      } catch (err) {
        logger.warn({ err, deliveryId: event.id }, "Dep bump merge history handler failed; continuing");
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action: (payload as unknown as { action?: string }).action,
      jobType: "dep-bump-merge-history",
      prNumber: pr.number,
    });
  }

  eventRouter.register("pull_request.closed", handlePullRequestClosed);
}
