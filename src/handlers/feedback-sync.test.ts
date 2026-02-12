import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createFeedbackSyncHandler } from "./feedback-sync.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue } from "../jobs/types.ts";

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

describe("createFeedbackSyncHandler", () => {
  test("syncs thumbs reactions for linked findings", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const recorded: Array<Record<string, unknown>> = [];

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

    createFeedbackSyncHandler({
      eventRouter,
      jobQueue,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            reactions: {
              listForPullRequestReviewComment: async () => ({
                data: [
                  {
                    id: 9001,
                    content: "+1",
                    user: { login: "alice", type: "User" },
                    created_at: "2026-02-12T00:00:00Z",
                  },
                ],
              }),
            },
          },
        }) as never,
      } as never,
      knowledgeStore: {
        listRecentFindingCommentCandidates: () => [
          {
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
          },
        ],
        recordFeedbackReactions: (reactions: Array<Record<string, unknown>>) => {
          recorded.push(...(reactions as unknown as Array<Record<string, unknown>>));
        },
      } as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.opened");
    expect(handler).toBeDefined();

    await handler!(buildPullRequestOpenedEvent());

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.reactionContent).toBe("+1");
    expect(recorded[0]?.findingId).toBe(7);
  });
});
