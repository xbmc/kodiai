import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { JobSnapshot } from "../jobs/types.ts";
import { createIssueCommentWithPublicationPipeline } from "../lib/github-publication.ts";
import { raceWithTimeout } from "../lib/with-timeout.ts";

// Job types whose `key` is an `owner/repo#number` queue key (buildReviewFamilyKey
// in jobs/review-work-coordinator.ts, buildMentionQueueKey in
// handlers/mention-workspace.ts) and whose loss is worth a PR-visible notice.
// `mention` is included because an explicit `@kodiai review` request is the work
// a user is most likely to notice going missing. Other job types (sync,
// background maintenance) have no PR to notify and are silently skipped.
const NOTIFIABLE_JOB_TYPES = new Set([
  "pull-request-review",
  "pull-request-review-retry",
  "mention",
]);

const REVIEW_FAMILY_KEY_PATTERN = /^([^/]+)\/([^#]+)#(\d+)$/;

const DEFAULT_PER_NOTICE_TIMEOUT_MS = 8_000;

/** Upper bound on PR comments a single force-exit may post. */
const DEFAULT_MAX_NOTICES = 20;

/** Phase assigned at enqueue time; a job still in it never began executing. */
const QUEUED_PHASE = "queued";

const RETRY_HINT =
  "Please retry (e.g. comment `@kodiai review`, or push a new commit) to get a fresh review.";

/**
 * The notice must describe what actually happened to *this* job. A job still in
 * the `queued` phase never started, so claiming it "was still running" is a
 * false statement to the reader; a `mention` job is not necessarily a review at
 * all. Pick wording from the job's own state rather than asserting one story.
 */
function buildAbandonedJobNoticeBody(job: JobSnapshot): string {
  const label = job.jobType === "mention" ? "Request" : "Review";
  const whatHappened = job.phase === QUEUED_PHASE
    ? "was still queued and had not started when the service restarted for a deploy"
    : "was still running when the service restarted for a deploy and could not finish";

  return `**${label} interrupted by deploy.** This ${label.toLowerCase()} ${whatHappened}. `
    + `Nothing was silently skipped -- the job was abandoned in place. ${RETRY_HINT}`;
}

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
  /** Max PR comments a single force-exit may post. Default: 20. */
  maxNotices?: number;
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
  const {
    logger,
    getInstallationOctokit,
    getAppSlug,
    perNoticeTimeoutMs = DEFAULT_PER_NOTICE_TIMEOUT_MS,
    maxNotices = DEFAULT_MAX_NOTICES,
  } = deps;

  async function notifyOne(job: JobSnapshot): Promise<void> {
    const parsed = parseReviewFamilyKey(job.key);
    if (!parsed) {
      logger.warn(
        { jobId: job.jobId, jobType: job.jobType, key: job.key },
        "Abandoned-job notice skipped: job key did not resolve to owner/repo/PR",
      );
      return;
    }
    const { owner, repo } = parsed;
    // The snapshot's own prNumber is authoritative when present; the key is only
    // a fallback for job types that do not carry one.
    const prNumber = job.prNumber ?? parsed.prNumber;

    const outcome = await raceWithTimeout(
      (async () => {
        const octokit = await getInstallationOctokit(job.installationId);
        await createIssueCommentWithPublicationPipeline(octokit, {
          owner,
          repo,
          issue_number: prNumber,
          body: buildAbandonedJobNoticeBody(job),
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

      // A review job and the retry it spawned share a review-family key and can
      // both be active at force-exit, which would post two identical notices on
      // one PR. Collapse to one notice per resolved PR, preferring a job that
      // actually started so the wording reflects the furthest progress made.
      const byPr = new Map<string, JobSnapshot>();
      const unresolvable: JobSnapshot[] = [];
      for (const job of notifiable) {
        const parsed = parseReviewFamilyKey(job.key);
        if (!parsed) {
          // Cannot be notified, so must not consume the notice budget below --
          // enough of them would otherwise crowd out every real PR.
          unresolvable.push(job);
          continue;
        }
        const prKey = `${parsed.owner}/${parsed.repo}#${job.prNumber ?? parsed.prNumber}`;
        const existing = byPr.get(prKey);
        if (!existing || (existing.phase === QUEUED_PHASE && job.phase !== QUEUED_PHASE)) {
          byPr.set(prKey, job);
        }
      }
      const deduped = [...byPr.values()];

      if (unresolvable.length > 0) {
        logger.warn(
          {
            count: unresolvable.length,
            jobs: unresolvable.slice(0, 20).map((job) => ({ jobId: job.jobId, jobType: job.jobType, key: job.key })),
          },
          "Abandoned-job notices skipped: job keys did not resolve to owner/repo/PR",
        );
      }

      // A deploy during a busy period can abandon a long queue, and one comment
      // per PR is still unbounded from GitHub's perspective. Cap the fan-out and
      // spend it on jobs that actually started -- those represent work that was
      // genuinely lost mid-flight, whereas a queued job never produced anything.
      const ordered = [...deduped].sort((a, b) => {
        const aQueued = a.phase === QUEUED_PHASE ? 1 : 0;
        const bQueued = b.phase === QUEUED_PHASE ? 1 : 0;
        return aQueued - bQueued;
      });
      const selected = ordered.slice(0, maxNotices);
      const droppedForCap = ordered.length - selected.length;

      logger.warn(
        {
          count: selected.length,
          suppressedDuplicates: notifiable.length - deduped.length,
          droppedForCap,
          maxNotices,
          jobIds: selected.map((job) => job.jobId),
        },
        droppedForCap > 0
          ? "Notifying PRs of review jobs abandoned by shutdown force-exit (notice cap reached, some PRs not notified)"
          : "Notifying PRs of review jobs abandoned by shutdown force-exit",
      );

      await Promise.allSettled(selected.map((job) => notifyOne(job)));
    },
  };
}
