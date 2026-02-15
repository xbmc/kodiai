import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createDepBumpMergeHistoryHandler } from "./dep-bump-merge-history.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";

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

function buildPullRequestClosedEvent(params: {
  merged: boolean;
  title: string;
  senderLogin: string;
  prNumber?: number;
}): WebhookEvent {
  return {
    id: "delivery-dep-bump-1",
    name: "pull_request",
    installationId: 42,
    payload: {
      action: "closed",
      repository: {
        name: "repo",
        owner: { login: "acme" },
      },
      pull_request: {
        number: params.prNumber ?? 101,
        merged: params.merged,
        merged_at: params.merged ? "2026-02-15T00:00:00Z" : null,
        title: params.title,
        body: "",
        user: { login: params.senderLogin },
        head: { ref: "feature" },
        labels: [],
      },
    },
  };
}

describe("createDepBumpMergeHistoryHandler", () => {
  test("merged dep bump PR records one merge-history row", async () => {
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

    const githubApp: GitHubApp = {
      initialize: async () => undefined,
      getAppSlug: () => "kodiai",
      getInstallationOctokit: async () =>
        ({
          rest: {
            pulls: {
              listFiles: async () => {
                throw new Error("no network in unit test");
              },
            },
          },
        }) as never,
    } as unknown as GitHubApp;

    createDepBumpMergeHistoryHandler({
      eventRouter,
      jobQueue,
      githubApp,
      knowledgeStore: {
        recordDepBumpMergeHistory: (entry: Record<string, unknown>) => {
          recorded.push(entry);
        },
      } as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.closed");
    expect(handler).toBeDefined();

    await handler!(
      buildPullRequestClosedEvent({
        merged: true,
        title: "Bump lodash from 4.17.21 to 4.17.22",
        senderLogin: "dependabot[bot]",
        prNumber: 22,
      }),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.repo).toBe("acme/repo");
    expect(recorded[0]?.prNumber).toBe(22);
    expect(recorded[0]?.deliveryId).toBe("delivery-dep-bump-1");
  });

  test("merged non-dep PR does not record merge-history row", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const recorded: Array<Record<string, unknown>> = [];

    createDepBumpMergeHistoryHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
      },
      githubApp: {
        initialize: async () => undefined,
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({ rest: { pulls: { listFiles: async () => ({ data: [] }) } } }) as never,
      } as unknown as GitHubApp,
      knowledgeStore: {
        recordDepBumpMergeHistory: (entry: Record<string, unknown>) => {
          recorded.push(entry);
        },
      } as never,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request.closed");
    expect(handler).toBeDefined();

    await handler!(
      buildPullRequestClosedEvent({
        merged: true,
        title: "Fix docs",
        senderLogin: "alice",
        prNumber: 23,
      }),
    );

    expect(recorded).toHaveLength(0);
  });
});
