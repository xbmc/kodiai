import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { JobSnapshot } from "../jobs/types.ts";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import { raceWithTimeout } from "../lib/with-timeout.ts";

// Job types whose `key` is the `owner/repo#prNumber` review-family key (see
// buildReviewFamilyKey in jobs/review-work-coordinator.ts) and whose loss is
// worth a PR-visible notice. Other job types (sync, background maintenance)
// have no PR to notify and are silently skipped.
const NOTIFIABLE_JOB_TYPES = new Set(["pull-request-review", "pull-request-review-retry"]);

const REVIEW_FAMILY_KEY_PATTERN = /^([^/]+)\/([^#]+)#(\d+)$/;

const DEFAULT_PER_NOTICE_TIMEOUT_MS = 8_000;

const ABANDONED_JOB_NOTICE_BODY =
  "**Review interrupted by deploy.** This review job was still running when the service " +
  "restarted for a deploy and could not finish. Nothing was silently skipped -- the job " +
  "was abandoned in place. Please retry (e.g. comment `@kodiai review`, or push a new " +
  "commit) to get a fresh review.";

interface ParsedReviewFamilyKey {
  owner: string;
  repo: string;
  prNumber: number;
}

function parseReviewFamilyKey(key: string): ParsedReviewFamilyKey | null {
  const match = REVIEW_FAMILY_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  const prNumber = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(prNumber)) {
    return null;
  }
  return { owner: match[1] ?? "", repo: match[2] ?? "", prNumber };
}

export interface AbandonedJobNotifierDeps {
  logger: Logger;
  getInstallationOctokit: (installationId: number) => Promise<Octokit>;
  getAppSlug: () => string;
  /** Per-notice timeout so a hung GitHub API call can't stall shutdown indefinitely. */
  perNoticeTimeoutMs?: number;
}

export interface AbandonedJobNotifier {
  /**
   * Best-effort: posts a "review interrupted by deploy" notice on the PR for
   * every abandoned review job whose key can be resolved to owner/repo/PR.
   * Never throws -- failures are logged and swallowed so a GitHub outage
   * cannot block process exit during an already-abandoned shutdown.
   */
  notify(jobs: JobSnapshot[]): Promise<void>;
}

/**
 * Create a notifier that posts a PR-visible notice when review jobs are
 * abandoned by a shutdown force-exit, so a dropped review is never silent.
 */
export function createAbandonedJobNotifier(deps: AbandonedJobNotifierDeps): AbandonedJobNotifier {
  const { logger, getInstallationOctokit, getAppSlug, perNoticeTimeoutMs = DEFAULT_PER_NOTICE_TIMEOUT_MS } = deps;

  async function notifyOne(job: JobSnapshot): Promise<void> {
    const parsed = parseReviewFamilyKey(job.key);
    if (!parsed) {
      logger.warn(
        { jobId: job.jobId, jobType: job.jobType, key: job.key },
        "Abandoned-job notice skipped: job key did not resolve to owner/repo/PR",
      );
      return;
    }
    const { owner, repo, prNumber } = parsed;

    const outcome = await raceWithTimeout(
      (async () => {
        const octokit = await getInstallationOctokit(job.installationId);
        await createIssueCommentWithPublicationPipeline(octokit, {
          owner,
          repo,
          issue_number: prNumber,
          body: ABANDONED_JOB_NOTICE_BODY,
          botHandles: [getAppSlug(), "claude"],
        });
      })().then(
        () => ({ ok: true as const }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
      { timeoutMs: perNoticeTimeoutMs, timeoutValue: { ok: false as const, err: new Error("timed out") } },
    );

    if (outcome.ok) {
      logger.warn(
        { jobId: job.jobId, jobType: job.jobType, owner, repo, prNumber },
        "Posted deploy-interruption notice for abandoned review job",
      );
    } else {
      logger.error(
        { err: outcome.err, jobId: job.jobId, jobType: job.jobType, owner, repo, prNumber },
        "Failed to post deploy-interruption notice for abandoned review job",
      );
    }
  }

  return {
    async notify(jobs: JobSnapshot[]): Promise<void> {
      const notifiable = jobs.filter((job) => job.jobType && NOTIFIABLE_JOB_TYPES.has(job.jobType));
      if (notifiable.length === 0) {
        return;
      }

      logger.warn(
        { count: notifiable.length, jobIds: notifiable.map((job) => job.jobId) },
        "Notifying PRs of review jobs abandoned by shutdown force-exit",
      );

      await Promise.allSettled(notifiable.map((job) => notifyOne(job)));
    },
  };
}
