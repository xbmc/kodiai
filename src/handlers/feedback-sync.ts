import type {
  IssueCommentCreatedEvent,
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewRequestedEvent,
  PullRequestReviewSubmittedEvent,
} from "@octokit/webhooks-types";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

type SyncCandidate = {
  findingId: number;
  reviewId: number;
  repo: string;
  commentId: number;
  commentSurface: "pull_request_review_comment";
  reviewOutputKey: string;
  severity: "critical" | "major" | "medium" | "minor";
  category: "security" | "correctness" | "performance" | "style" | "documentation";
  filePath: string;
  title: string;
  createdAt: string;
};

type ReactionEntry = {
  id: number;
  content: string;
  user?: {
    login?: string;
    type?: string;
  } | null;
  created_at?: string | null;
};

const DEFAULT_MAX_CANDIDATES = 100;
const DEFAULT_RECENT_WINDOW_DAYS = 30;

function normalizeLogin(login: string | undefined): string {
  return (login ?? "").trim().toLowerCase().replace(/\[bot\]$/i, "");
}

function isRecentEnough(createdAt: string, recentWindowDays: number): boolean {
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) return false;
  const cutoff = Date.now() - recentWindowDays * 24 * 60 * 60 * 1000;
  return parsed >= cutoff;
}

function isHumanThumbReaction(reaction: ReactionEntry, appSlug: string): boolean {
  if (reaction.content !== "+1" && reaction.content !== "-1") return false;

  const userType = (reaction.user?.type ?? "").toLowerCase();
  if (userType === "bot") return false;

  const reactorLogin = normalizeLogin(reaction.user?.login);
  if (reactorLogin.length === 0) return false;
  if (reactorLogin === normalizeLogin(appSlug)) return false;

  return true;
}

function parseRepoFromEventPayload(event: WebhookEvent): string | undefined {
  const payload = event.payload as Record<string, unknown>;
  const repository = payload.repository as
    | {
        owner?: { login?: string };
        name?: string;
      }
    | undefined;

  const owner = repository?.owner?.login;
  const repo = repository?.name;
  if (!owner || !repo) return undefined;
  return `${owner}/${repo}`;
}

function eventTargetsPullRequest(event: WebhookEvent): boolean {
  if (event.name === "pull_request") return true;
  if (event.name === "pull_request_review_comment") return true;
  if (event.name === "pull_request_review") return true;
  if (event.name !== "issue_comment") return false;

  const payload = event.payload as unknown as IssueCommentCreatedEvent;
  return Boolean(payload.issue?.pull_request);
}

export function createFeedbackSyncHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  knowledgeStore?: KnowledgeStore;
  logger: Logger;
  maxCandidates?: number;
  recentWindowDays?: number;
}): void {
  const {
    eventRouter,
    jobQueue,
    githubApp,
    knowledgeStore,
    logger,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    recentWindowDays = DEFAULT_RECENT_WINDOW_DAYS,
  } = deps;

  async function handleSync(event: WebhookEvent): Promise<void> {
    if (!knowledgeStore) return;
    if (!eventTargetsPullRequest(event)) return;

    const repo = parseRepoFromEventPayload(event);
    if (!repo) return;

    await jobQueue.enqueue(event.installationId, async () => {
      const appSlug = githubApp.getAppSlug();

      let candidates: SyncCandidate[] = [];
      try {
        candidates = knowledgeStore
          .listRecentFindingCommentCandidates(repo, Math.max(1, maxCandidates))
          .filter((candidate) => isRecentEnough(candidate.createdAt, recentWindowDays));
      } catch (err) {
        logger.warn({ err, repo }, "Feedback sync candidate lookup failed; continuing");
        return;
      }

      if (candidates.length === 0) {
        return;
      }

      const octokit = await githubApp.getInstallationOctokit(event.installationId);
      const reactionsByCommentId = new Map<number, ReactionEntry[]>();

      const uniqueCommentIds = [...new Set(candidates.map((candidate) => candidate.commentId))];

      for (const commentId of uniqueCommentIds) {
        try {
          const response = await octokit.rest.reactions.listForPullRequestReviewComment({
            owner: repo.split("/")[0]!,
            repo: repo.split("/")[1]!,
            comment_id: commentId,
            per_page: 100,
          });

          reactionsByCommentId.set(commentId, response.data as ReactionEntry[]);
        } catch (err) {
          logger.warn(
            { err, repo, commentId },
            "Feedback sync reaction fetch failed for review comment; continuing",
          );
        }
      }

      const reactionsToRecord = candidates.flatMap((candidate) => {
        const rawReactions = reactionsByCommentId.get(candidate.commentId) ?? [];

        return rawReactions
          .filter((reaction) => isHumanThumbReaction(reaction, appSlug))
          .map((reaction) => ({
            repo: candidate.repo,
            reviewId: candidate.reviewId,
            findingId: candidate.findingId,
            commentId: candidate.commentId,
            commentSurface: candidate.commentSurface,
            reactionId: reaction.id,
            reactionContent: reaction.content as "+1" | "-1",
            reactorLogin: reaction.user?.login ?? "unknown",
            reactedAt: reaction.created_at ?? undefined,
            severity: candidate.severity,
            category: candidate.category,
            filePath: candidate.filePath,
            title: candidate.title,
          }));
      });

      if (reactionsToRecord.length === 0) {
        return;
      }

      try {
        knowledgeStore.recordFeedbackReactions(reactionsToRecord);
      } catch (err) {
        logger.warn({ err, repo }, "Feedback sync reaction persistence failed; continuing");
      }
    }, {
      deliveryId: event.id,
      eventName: event.name,
      action: (event.payload as Record<string, unknown>).action as string | undefined,
      jobType: "feedback-sync",
      prNumber: ((event.payload as Record<string, unknown>).pull_request as { number?: number } | undefined)
        ?.number,
    });
  }

  eventRouter.register("pull_request.opened", handleSync);
  eventRouter.register("pull_request.ready_for_review", handleSync);
  eventRouter.register("pull_request.review_requested", handleSync);
  eventRouter.register("issue_comment.created", handleSync);
  eventRouter.register("pull_request_review_comment.created", handleSync);
  eventRouter.register("pull_request_review.submitted", handleSync);
}
