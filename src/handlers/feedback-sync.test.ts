import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createFeedbackSyncHandler } from "./feedback-sync.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { FeedbackReaction, FindingCommentCandidate, KnowledgeStore } from "../knowledge/types.ts";

function createNoopLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createNoopLogger(),
  } as unknown as Logger;
}

function buildPullRequestOpenedEvent(): WebhookEvent {
  return {
    id: "delivery-feedback-1",
    name: "pull_request",
    installationId: 42,
    payload: {
      action: "opened",
      repository: {
        owner: { login: "acme" },
        name: "repo",
      },
      pull_request: {
        number: 101,
      },
    },
  };
}

function buildIssueCommentEvent(opts: { hasPullRequest: boolean }): WebhookEvent {
  return {
    id: "delivery-feedback-2",
    name: "issue_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        owner: { login: "acme" },
        name: "repo",
      },
      issue: opts.hasPullRequest ? { pull_request: { url: "https://example.test/pull/1" } } : {},
    },
  };
}

function buildCandidate(overrides: Partial<FindingCommentCandidate> = {}): FindingCommentCandidate {
  return {
    findingId: 7,
    reviewId: 3,
    repo: "acme/repo",
    commentId: 55,
    commentSurface: "pull_request_review_comment",
    reviewOutputKey: "output-key",
    severity: "major",
    category: "correctness",
    filePath: "src/index.ts",
    title: "Handle null case",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createCaptureLogger(): {
  logger: Logger;
  warnings: Array<{ message: string; data?: Record<string, unknown> }>;
} {
  const warnings: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const noop = () => undefined;
  const warn = (data: unknown, message?: string) => {
    if (typeof data === "string") {
      warnings.push({ message: data });
      return;
    }
    warnings.push({ message: message ?? "", data: (data ?? {}) as Record<string, unknown> });
  };

  return {
    logger: {
      info: noop,
      warn,
      error: noop,
      debug: noop,
      trace: noop,
      fatal: noop,
      child: () => createNoopLogger(),
    } as unknown as Logger,
    warnings,
  };
}

function createHarness(opts: {
  candidates?: FindingCommentCandidate[];
  listReactions?: (commentId: number) => Promise<Array<Record<string, unknown>>>;
  recordFeedbackReactions?: (reactions: FeedbackReaction[]) => void;
  logger?: Logger;
}): {
  handlers: Map<string, (event: WebhookEvent) => Promise<void>>;
  recorded: FeedbackReaction[];
} {
  const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
  const recorded: FeedbackReaction[] = [];

  const eventRouter: EventRouter = {
    register: (eventKey, handler) => {
      handlers.set(eventKey, handler);
    },
    dispatch: async () => undefined,
  };

  const jobQueue: JobQueue = {
    enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
    getQueueSize: () => 0,
    getPendingCount: () => 0,
  };

  const githubApp: GitHubApp = {
    getAppSlug: () => "kodiai",
    getInstallationOctokit: async () => ({
      rest: {
        reactions: {
          listForPullRequestReviewComment: async ({ comment_id }: { comment_id: number }) => ({
            data: await (opts.listReactions?.(comment_id) ?? Promise.resolve([])),
          }),
        },
      },
    }) as never,
  } as never;

  const knowledgeStore = {
    recordReview: () => 0,
    recordFindings: () => undefined,
    listRecentFindingCommentCandidates: () => opts.candidates ?? [buildCandidate()],
    recordFeedbackReactions: (reactions: FeedbackReaction[]) => {
      if (opts.recordFeedbackReactions) {
        opts.recordFeedbackReactions(reactions);
        return;
      }
      recorded.push(...reactions);
    },
    recordSuppressionLog: () => undefined,
    recordGlobalPattern: () => undefined,
    getRepoStats: () => ({
      totalReviews: 0,
      totalFindings: 0,
      findingsBySeverity: {},
      totalSuppressed: 0,
      avgFindingsPerReview: 0,
      avgConfidence: 0,
      topFiles: [],
    }),
    getRepoTrends: () => [],
    checkpoint: () => undefined,
    close: () => undefined,
  } as unknown as KnowledgeStore;

  createFeedbackSyncHandler({
    eventRouter,
    jobQueue,
    githubApp,
    knowledgeStore,
    logger: opts.logger ?? createNoopLogger(),
  });

  return { handlers, recorded };
}

describe("createFeedbackSyncHandler", () => {
  test("captures only +1/-1 human reactions and correlates writes to finding ids", async () => {
    const { handlers, recorded } = createHarness({
      listReactions: async () => [
        {
          id: 9001,
          content: "+1",
          user: { login: "alice", type: "User" },
          created_at: "2026-02-12T00:00:00Z",
        },
        {
          id: 9002,
          content: "-1",
          user: { login: "bob", type: "User" },
          created_at: "2026-02-12T00:05:00Z",
        },
        {
          id: 9003,
          content: "heart",
          user: { login: "carol", type: "User" },
          created_at: "2026-02-12T00:10:00Z",
        },
        {
          id: 9004,
          content: "+1",
          user: { login: "kodiai[bot]", type: "Bot" },
          created_at: "2026-02-12T00:11:00Z",
        },
      ],
    });

    const handler = handlers.get("pull_request.opened");
    expect(handler).toBeDefined();

    await handler!(buildPullRequestOpenedEvent());

    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.reactionContent).toBe("+1");
    expect(recorded[1]?.reactionContent).toBe("-1");
    expect(recorded[0]?.findingId).toBe(7);
    expect(recorded[1]?.findingId).toBe(7);
  });

  test("repeat sync runs remain dedupe-safe through store insert contract", async () => {
    const persistedKeys = new Set<string>();
    const persisted: FeedbackReaction[] = [];

    const { handlers } = createHarness({
      listReactions: async () => [
        {
          id: 10001,
          content: "+1",
          user: { login: "dana", type: "User" },
          created_at: "2026-02-12T01:00:00Z",
        },
      ],
      recordFeedbackReactions: (reactions) => {
        for (const reaction of reactions) {
          const key = `${reaction.repo}:${reaction.commentId}:${reaction.reactionId}`;
          if (persistedKeys.has(key)) continue;
          persistedKeys.add(key);
          persisted.push(reaction);
        }
      },
    });

    const handler = handlers.get("pull_request.opened");
    expect(handler).toBeDefined();

    await handler!(buildPullRequestOpenedEvent());
    await handler!(buildPullRequestOpenedEvent());

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.reactionId).toBe(10001);
  });

  test("logs API/store failures and never throws through webhook dispatch path", async () => {
    const { logger, warnings } = createCaptureLogger();
    let shouldThrowStoreError = true;

    const { handlers } = createHarness({
      candidates: [
        buildCandidate({ findingId: 1, commentId: 11 }),
        buildCandidate({ findingId: 2, commentId: 12 }),
      ],
      listReactions: async (commentId) => {
        if (commentId === 11) {
          throw new Error("GitHub rate limit");
        }
        return [
          {
            id: 20001,
            content: "+1",
            user: { login: "erin", type: "User" },
            created_at: "2026-02-12T01:15:00Z",
          },
        ];
      },
      recordFeedbackReactions: () => {
        if (shouldThrowStoreError) {
          shouldThrowStoreError = false;
          throw new Error("SQLite busy");
        }
      },
      logger,
    });

    const handler = handlers.get("pull_request.opened");
    expect(handler).toBeDefined();

    await expect(handler!(buildPullRequestOpenedEvent())).resolves.toBeUndefined();
    expect(
      warnings.some((entry) =>
        entry.message.includes("Feedback sync reaction fetch failed for review comment; continuing")
      ),
    ).toBe(true);
    expect(
      warnings.some((entry) =>
        entry.message.includes("Feedback sync reaction persistence failed; continuing")
      ),
    ).toBe(true);
  });

  test("ignores non-PR issue comments and avoids write-mode side effects", async () => {
    let reactionsListCalls = 0;
    const { handlers, recorded } = createHarness({
      listReactions: async () => {
        reactionsListCalls += 1;
        return [];
      },
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(buildIssueCommentEvent({ hasPullRequest: false }));

    expect(reactionsListCalls).toBe(0);
    expect(recorded).toHaveLength(0);
  });
});
