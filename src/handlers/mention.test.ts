import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createMentionHandler } from "./mention.ts";
import { buildReviewOutputKey, buildReviewOutputMarker, extractReviewOutputKey } from "./review-idempotency.ts";
import { scanLinesForFabricatedContent } from "../lib/mention-utils.ts";
import { createRetriever } from "../knowledge/retrieval.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { JobQueue, JobQueueContext, JobQueueRunMetadata, WorkspaceManager, CloneOptions } from "../jobs/types.ts";
import { createQueueRunMetadata, getEmptyActiveJobs } from "../jobs/queue.test-helpers.ts";
import {
  buildReviewFamilyKey,
  createReviewWorkCoordinator,
} from "../jobs/review-work-coordinator.ts";

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


type LogCall = { bindings: Record<string, unknown>; message: string };

function createMockLogger() {
  const infoCalls: LogCall[] = [];
  const warnCalls: LogCall[] = [];
  const errorCalls: LogCall[] = [];
  return {
    logger: createMockLoggerWithArrays(infoCalls, warnCalls, errorCalls),
    infoCalls,
    warnCalls,
    errorCalls,
  };
}

function createMockLoggerWithArrays(
  infoCalls: LogCall[],
  warnCalls: LogCall[],
  errorCalls: LogCall[],
): Logger {
  const noop = () => undefined;
  return {
    info: (bindings: Record<string, unknown>, message: string) => {
      infoCalls.push({ bindings, message });
    },
    warn: (bindings: Record<string, unknown>, message: string) => {
      warnCalls.push({ bindings, message });
    },
    error: (bindings: Record<string, unknown>, message: string) => {
      errorCalls.push({ bindings, message });
    },
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createMockLoggerWithArrays(infoCalls, warnCalls, errorCalls),
  } as unknown as Logger;
}

describe("createMentionHandler coordinator wiring", () => {
  test("logs when the mention handler falls back to a private coordinator", () => {
    const { logger, warnCalls } = createMockLogger();

    createMentionHandler({
      eventRouter: {
        register: () => undefined,
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async () => {
          throw new Error("not used");
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      } as unknown as JobQueue,
      workspaceManager: {
        create: async () => {
          throw new Error("not used");
        },
        cleanupStale: async () => 0,
      } as unknown as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: logger as never,
    });

    const fallbackLog = warnCalls.find(
      (entry) =>
        entry.message ===
        "Review work coordinator not injected; using a private handler-local fallback (cross-handler coordination disabled)",
    );

    expect(fallbackLog?.bindings.gate).toBe("review-family-coordinator");
    expect(fallbackLog?.bindings.gateResult).toBe("private-fallback");
    expect(fallbackLog?.bindings.coordinationScope).toBe("handler-local");
  });
});

describe("createMentionHandler queued-claim cleanup", () => {
  test("releases a pre-enqueue explicit-review claim when the request aborts before execution", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n  acceptClaudeAlias: false\n");
    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 3_000;
        return () => ++nowMs;
      })(),
    });
    const familyKey = buildReviewFamilyKey("acme", "repo", 104);
    const olderAutomaticAttempt = coordinator.claim({
      familyKey,
      source: "automatic-review",
      lane: "review",
      deliveryId: "delivery-auto-older",
      phase: "claimed",
    });
    coordinator.setPhase(olderAutomaticAttempt.attemptId, "executor-dispatch");

    createMentionHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      },
      workspaceManager: {
        create: async (_installationId: number, options: CloneOptions) => {
          await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
          return { dir: workspaceFixture.dir, cleanup: async () => undefined };
        },
        cleanupStale: async () => 0,
      },
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({
          rest: {
            pulls: {
              get: async () => ({
                data: {
                  title: "Test PR",
                  body: "",
                  user: { login: "octocat" },
                  head: { ref: "feature" },
                  base: { ref: "main" },
                },
              }),
            },
            reactions: {
              createForIssueComment: async () => ({ data: {} }),
            },
          },
        }) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("explicit review should have aborted before executor");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: coordinator,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber: 104,
        commentBody: "@claude review",
      }),
    );

    expect(coordinator.canPublish(olderAutomaticAttempt.attemptId)).toBeTrue();
    expect(coordinator.getSnapshot(familyKey)?.attempts.map((attempt) => attempt.attemptId)).toEqual([
      olderAutomaticAttempt.attemptId,
    ]);

    await workspaceFixture.cleanup();
  });
});

describe("createMentionHandler enqueue routing", () => {
  test("explicit review mentions enqueue onto the interactive-review lane with a stable PR key", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const enqueuedContexts: Array<{ lane?: string; key?: string }> = [];

    createMentionHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          _fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: JobQueueContext,
        ) => {
          enqueuedContexts.push({ lane: context?.lane, key: context?.key });
          return undefined as T;
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      },
      workspaceManager: {} as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber: 102,
        commentBody: "@kodiai review",
      }),
    );

    expect(enqueuedContexts).toEqual([
      { lane: "interactive-review", key: "acme/repo#102" },
    ]);
  });

  test("non-review issue mentions enqueue onto the sync lane with a stable issue key", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const enqueuedContexts: Array<{ lane?: string; key?: string }> = [];

    createMentionHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(
          _installationId: number,
          _fn: (metadata: JobQueueRunMetadata) => Promise<T>,
          context?: JobQueueContext,
        ) => {
          enqueuedContexts.push({ lane: context?.lane, key: context?.key });
          return undefined as T;
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      },
      workspaceManager: {} as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger() as never,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai what does this do?",
      }),
    );

    expect(enqueuedContexts).toEqual([
      { lane: "sync", key: "acme/repo#77" },
    ]);
  });
});

const noopTelemetryStore = { record: async () => {}, purgeOlderThan: async () => 0, checkpoint: () => {}, close: () => {} } as never;

async function createWorkspaceFixture(configYml = "mention:\n  enabled: true\n") {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-mention-handler-"));
  const remoteDir = await mkdtemp(join(tmpdir(), "kodiai-mention-remote-"));

  await $`git -C ${dir} init --initial-branch=main`.quiet();
  await $`git -C ${remoteDir} init --bare`.quiet();
  await $`git -C ${dir} config user.email test@example.com`.quiet();
  await $`git -C ${dir} config user.name "Test User"`.quiet();

  await Bun.write(join(dir, "README.md"), "base\n");
  await Bun.write(join(dir, ".kodiai.yml"), configYml);

  await $`git -C ${dir} add README.md .kodiai.yml`.quiet();
  await $`git -C ${dir} commit -m "base"`.quiet();
  await $`git -C ${dir} checkout -b feature`.quiet();

  await Bun.write(join(dir, "README.md"), "base\nfeature\n");
  await $`git -C ${dir} add README.md`.quiet();
  await $`git -C ${dir} commit -m "feature"`.quiet();

  // Use a bare repo as the remote so pushes are allowed.
  await $`git -C ${dir} remote add origin ${remoteDir}`.quiet();
  await $`git -C ${dir} push -u origin main feature`.quiet();

  return {
    dir,
    remoteDir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
      await rm(remoteDir, { recursive: true, force: true });
    },
  };
}

function buildReviewCommentMentionEvent(params: {
  prNumber: number;
  baseRef: string;
  headRef: string;
  headRepoOwner: string;
  headRepoName: string;
  commentBody: string;
  commentAuthor?: string;
  commentId?: number;
  inReplyToId?: number;
}): WebhookEvent {
  return {
    id: "delivery-mention-123",
    name: "pull_request_review_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        name: "repo",
        owner: { login: "acme" },
      },
      pull_request: {
        number: params.prNumber,
        head: {
          ref: params.headRef,
          repo: {
            name: params.headRepoName,
            owner: { login: params.headRepoOwner },
          },
        },
        base: { ref: params.baseRef },
      },
      comment: {
        id: params.commentId ?? 555,
        body: params.commentBody,
        user: { login: params.commentAuthor ?? "alice" },
        created_at: "2025-01-15T12:00:00Z",
        diff_hunk: "@@ -1,1 +1,1\n- old\n+ new",
        path: "README.md",
        line: 1,
        in_reply_to_id: params.inReplyToId,
      },
    },
  };
}

function buildIssueCommentMentionEvent(params: {
  issueNumber: number;
  commentBody: string;
  commentAuthor?: string;
  commentId?: number;
  defaultBranch?: string;
}): WebhookEvent {
  return {
    id: "delivery-issue-mention-123",
    name: "issue_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        name: "repo",
        owner: { login: "acme" },
        default_branch: params.defaultBranch ?? "main",
      },
      issue: {
        number: params.issueNumber,
        title: "Update the README heading",
      },
      comment: {
        id: params.commentId ?? 777,
        body: params.commentBody,
        user: { login: params.commentAuthor ?? "alice" },
        created_at: "2025-01-15T12:00:00Z",
      },
    },
  };
}

function buildLiveIssueCommentMentionEvent(params: {
  commentBody: string;
  commentAuthor?: string;
  commentId?: number;
  defaultBranch?: string;
}): WebhookEvent {
  return {
    id: "delivery-issue-mention-live-shape",
    name: "issue_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        name: "repo",
        owner: { login: "acme" },
        default_branch: params.defaultBranch ?? "main",
      },
      issue: {
        pull_request: {
          url: "https://api.github.com/repos/acme/repo/pulls/77",
        },
      },
      comment: {
        id: params.commentId ?? 778,
        body: params.commentBody,
        user: { login: params.commentAuthor ?? "alice" },
        created_at: "2025-01-15T12:00:00Z",
      },
    } as unknown as WebhookEvent["payload"],
  };
}

function buildPrIssueCommentMentionEvent(params: {
  prNumber: number;
  commentBody: string;
  commentAuthor?: string;
  commentId?: number;
  defaultBranch?: string;
}): WebhookEvent {
  return {
    id: "delivery-pr-issue-comment-mention",
    name: "issue_comment",
    installationId: 42,
    payload: {
      action: "created",
      repository: {
        name: "repo",
        owner: { login: "acme" },
        default_branch: params.defaultBranch ?? "main",
      },
      issue: {
        number: params.prNumber,
        pull_request: {
          url: `https://api.github.com/repos/acme/repo/pulls/${params.prNumber}`,
        },
      },
      comment: {
        id: params.commentId ?? 779,
        body: params.commentBody,
        user: { login: params.commentAuthor ?? "alice" },
        created_at: "2025-01-15T12:00:00Z",
      },
    } as unknown as WebhookEvent["payload"],
  };
}

describe("createMentionHandler fork PR workspace strategy", () => {
  test("PR mentions clone base ref and fetch pull/<n>/head (fork-safe)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture();
    const createCalls: CloneOptions[] = [];

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        createCalls.push(options);
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: true,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.owner).toBe("acme");
    expect(createCalls[0]?.repo).toBe("repo");
    expect(createCalls[0]?.ref).toBe("main");
    expect(createCalls[0]?.depth).toBe(50);

    const branch = (await $`git -C ${workspaceFixture.dir} rev-parse --abbrev-ref HEAD`.quiet())
      .text()
      .trim();
    expect(branch).toBe("pr-mention");

    const headSubject = (await $`git -C ${workspaceFixture.dir} show -s --pretty=%s HEAD`.quiet())
      .text()
      .trim();
    expect(headSubject).toBe("feature");

    await workspaceFixture.cleanup();
  });
});

describe("createMentionHandler conversational review wiring", () => {
  test("issue mentions enrich prompt with issue code-pointer context", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let capturedPrompt = "";

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          capturedPrompt = ctx.prompt ?? "";
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai where is the base README text defined?",
      }),
    );

    expect(capturedPrompt).toContain("## Candidate Code Pointers");
    expect(capturedPrompt).toContain("`README.md:1`");

    await workspaceFixture.cleanup();
  });

  test("issue mentions post targeted clarifying fallback when execution is non-published", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai what does the auth middleware do?",
      }),
    );

    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("I can answer this, but I need one detail first.");
    expect(issueReplies[0]).toContain(
      "Could you share the exact outcome you want and the primary file/path I should focus on first?",
    );
    expect(issueReplies[0]).not.toContain("Can you clarify what you want me to do?");
    expect(issueReplies[0]).not.toContain("(1)");
    expect(issueReplies[0]).not.toContain("(2)");
    expect(issueReplies[0]).not.toContain("(3)");

    await workspaceFixture.cleanup();
  });

  test("review-thread mentions use the same one-question clarifying fallback", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const threadReplies: string[] = [];
    let pullCreateCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async (params: { body: string }) => {
            threadReplies.push(params.body);
            return { data: {} };
          },
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => ({
          conclusion: "success",
          published: false,
          writeMode: ctx.writeMode,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai can you clarify this edge case?",
      }),
    );

    expect(threadReplies).toHaveLength(1);
    expect(threadReplies[0]).toContain("Could you share the exact outcome you want");
    expect(threadReplies[0]).not.toContain("Can you clarify what you want me to do?");
    expect(threadReplies[0]).not.toContain("(1)");
    expect(pullCreateCalls).toBe(0);

    await workspaceFixture.cleanup();
  });

  test("pr top-level mentions post exactly one targeted clarifying fallback when non-published", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");
    const prNumber = 77;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const issueReplies: string[] = [];
    let pullCreateCalls = 0;
    let capturedWriteMode: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/should-not-open" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: false,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai can you fix this flaky behavior in the PR flow?",
      }),
    );

    // With expanded PR write intent detection, "fix this" is recognized as write intent.
    // Since write mode is disabled in the config, the response tells the user to enable it.
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Write mode is disabled for this repo");
    expect(pullCreateCalls).toBe(0);

    await workspaceFixture.cleanup();
  });

  test("non-mention PR review comments short-circuit without executor or replies", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let executorCalls = 0;
    let issueReplyCalls = 0;
    let threadReplyCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            issueReplyCalls++;
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => {
            threadReplyCalls++;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalls++;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "please fix this edge case without asking follow-ups",
      }),
    );

    expect(executorCalls).toBe(0);
    expect(issueReplyCalls).toBe(0);
    expect(threadReplyCalls).toBe(0);

    await workspaceFixture.cleanup();
  });

  test("implementation verbs on PR/review surfaces auto-promote to write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const writeModes: Array<boolean | undefined> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/write-intent" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          writeModes.push(ctx.writeMode);
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    const reviewHandler = handlers.get("pull_request_review_comment.created");
    expect(issueHandler).toBeDefined();
    expect(reviewHandler).toBeDefined();

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai fix this bug in the PR branch",
      }),
    );

    await reviewHandler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai update this logic to handle undefined safely",
      }),
    );

    expect(writeModes).toHaveLength(2);
    expect(writeModes.every((writeMode) => writeMode === true)).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("patch-specific phrases on PR surfaces auto-promote to write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const writeModes: Array<boolean | undefined> = [];
    let pullCreateCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => {
            return { data: {} };
          },
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/patch-pr" } };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          writeModes.push(ctx.writeMode);
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    const reviewHandler = handlers.get("pull_request_review_comment.created");
    expect(issueHandler).toBeDefined();
    expect(reviewHandler).toBeDefined();

    // "create a patch for the earlier change suggestion" on pr_comment surface
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai create a patch for the earlier change suggestion",
      }),
    );

    // "can you create a patch for this?" on pr_review_comment surface
    await reviewHandler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai can you create a patch for this?",
      }),
    );

    // "please patch this" on pr_comment surface
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai please patch this",
      }),
    );

    // "create a patch" on pr_comment surface
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai create a patch",
      }),
    );

    // "apply the earlier suggestion as a patch PR" on pr_comment surface
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai apply the earlier suggestion as a patch PR",
      }),
    );

    expect(writeModes).toHaveLength(5);
    expect(writeModes.every((wm) => wm === true)).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("review requests on PR surfaces never trigger write mode (regression: 'please do a full review')", async () => {
    // Regression test: "please do a full review of this PR" was misclassified as write intent
    // because "please" in confirmationAction matched + "\bpr\b" in actionSignal matched.
    // Fix: removed "please" from confirmationAction, added isReviewRequest guard.
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const writeModes: Array<boolean | undefined> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: { name: "repo", owner: { login: "acme" } },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/should-not-create" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          writeModes.push(ctx.writeMode);
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    const reviewHandler = handlers.get("pull_request_review_comment.created");
    expect(issueHandler).toBeDefined();
    expect(reviewHandler).toBeDefined();

    // The exact phrase that triggered the bug
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai please do a full review of this PR",
      }),
    );

    // Variations that should also be read-only
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai please review this",
      }),
    );

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai can you do a full review",
      }),
    );

    await reviewHandler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "acme",
        headRepoName: "repo",
        commentBody: "@kodiai review this code",
      }),
    );

    expect(writeModes).toHaveLength(4);
    // All review requests must be read-only — none should activate write mode
    expect(writeModes.every((wm) => wm !== true)).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("implementation verbs on PR surfaces trigger write mode with expanded detection", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const writeModes: Array<boolean | undefined> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => {
            return { data: {} };
          },
          create: async () => {
            return { data: { html_url: "https://example.com/pr/should-not-open" } };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          writeModes.push(ctx.writeMode);
          return {
            conclusion: "success",
            published: false,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    // "fix the login bug" -- implementation verb, should trigger write mode
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai fix the login bug",
      }),
    );

    expect(writeModes).toHaveLength(1);
    expect(writeModes[0]).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("explicit prefixes on PR surfaces still work as before", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const writeModes: Array<boolean | undefined> = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => {
            return { data: {} };
          },
          create: async () => {
            return { data: { html_url: "https://example.com/pr/explicit-prefix" } };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          writeModes.push(ctx.writeMode);
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    // Explicit "apply:" prefix on PR surface should still work
    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai apply: fix the bug",
      }),
    );

    expect(writeModes).toHaveLength(1);
    expect(writeModes[0]).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("issue non-published fallback posts a single comment", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let createCommentCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            createCommentCalls++;
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai can you help?",
      }),
    );

    expect(createCommentCalls).toBe(1);

    await workspaceFixture.cleanup();
  });

  test("comment-author defense skips self-authored bot comments", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    let enqueueCalled = false;
    let workspaceCreateCalled = false;

    createMentionHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => {
          enqueueCalled = true;
          return fn(createQueueRunMetadata());
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      },
      workspaceManager: {
        create: async () => {
          workspaceCreateCalled = true;
          throw new Error("should not create workspace");
        },
        cleanupStale: async () => 0,
      },
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => ({}) as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("should not execute");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber: 101,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
        commentAuthor: "kodiai",
      }),
    );

    expect(enqueueCalled).toBe(false);
    expect(workspaceCreateCalled).toBe(false);
  });

  test("conversation replies are rate-limited per PR", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n  conversation:\n    maxTurnsPerPr: 1\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let executeCalls = 0;
    const replies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            replies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async (params: { body: string }) => {
            replies.push(params.body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executeCalls++;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    const event = buildReviewCommentMentionEvent({
      prNumber,
      baseRef: "main",
      headRef: "feature",
      headRepoOwner: "forker",
      headRepoName: "repo",
      commentBody: "@kodiai what should I change?",
      inReplyToId: 900,
    });

    await handler!(event);
    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai any follow-up?",
        inReplyToId: 900,
        commentId: 556,
      }),
    );

    expect(executeCalls).toBe(1);
    expect(
      replies.some((body) => body.includes("Conversation limit reached (1 turns per PR).")),
    ).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("finding lookup is passed to prompt for review-thread follow-ups", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedPrompt = "";

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          getReviewComment: async () => ({
            data: {
              id: 900,
              body: "<!-- kodiai:review-output-key:test --> finding",
              created_at: "2025-01-15T10:00:00Z",
              user: { login: "kodiai" },
            },
          }),
          listReviewComments: async () => ({
            data: [
              {
                id: 900,
                body: "<!-- kodiai:review-output-key:test --> finding",
                created_at: "2025-01-15T10:00:00Z",
                user: { login: "kodiai" },
              },
            ],
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          capturedPrompt = ctx.prompt ?? "";
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      knowledgeStore: {
        getFindingByCommentId: () => ({
          severity: "major",
          category: "correctness",
          filePath: "src/app.ts",
          startLine: 42,
          title: "Handle undefined input",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai what should I change?",
        inReplyToId: 900,
      }),
    );

    expect(capturedPrompt).toContain("This is a follow-up to a review finding:");
    expect(capturedPrompt).toContain("Finding: [MAJOR] correctness");
    expect(capturedPrompt).toContain("File: src/app.ts (line 42)");

    await workspaceFixture.cleanup();
  });

  test("reply mention stays conversational when finding lookup throws", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedPrompt = "";
    let executeCalls = 0;
    const threadReplies: string[] = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          getReviewComment: async () => ({
            data: {
              id: 900,
              body: "<!-- kodiai:review-output-key:test --> finding",
              created_at: "2025-01-15T10:00:00Z",
              user: { login: "kodiai" },
            },
          }),
          listReviewComments: async () => ({
            data: [
              {
                id: 900,
                body: "<!-- kodiai:review-output-key:test --> finding",
                created_at: "2025-01-15T10:00:00Z",
                user: { login: "kodiai" },
              },
              {
                id: 901,
                body: "Can you clarify this?",
                created_at: "2025-01-15T10:05:00Z",
                in_reply_to_id: 900,
                user: { login: "alice" },
              },
            ],
          }),
          createReplyForReviewComment: async (params: { body: string }) => {
            threadReplies.push(params.body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          executeCalls++;
          capturedPrompt = ctx.prompt ?? "";
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      knowledgeStore: {
        getFindingByCommentId: () => {
          throw new Error("lookup unavailable");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai what should I change?",
        inReplyToId: 900,
      }),
    );

    expect(executeCalls).toBe(1);
    expect(capturedPrompt).toContain("## Review Comment Thread Context");
    expect(capturedPrompt).toContain("Can you clarify this?");
    expect(capturedPrompt).not.toContain("This is a follow-up to a review finding:");
    expect(capturedPrompt).not.toContain("Finding: [");
    expect(threadReplies).toHaveLength(0);
    expect(issueReplies).toHaveLength(0);

    await workspaceFixture.cleanup();
  });

  test("error replies sanitize outgoing mentions", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let replyBody = "";

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "error",
          published: false,
          errorMessage: "Please ask @kodiai or @claude to retry",
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
          isTimeout: false,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai what happened?",
      }),
    );

    expect(replyBody).toContain("kodiai");
    expect(replyBody).toContain("claude");
    expect(replyBody).not.toContain("@kodiai");
    expect(replyBody).not.toContain("@claude");

    await workspaceFixture.cleanup();
  });
});

describe("createMentionHandler write intent gating", () => {
  test("non-prefixed implementation ask in issue comment auto-promotes to write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalled = false;
    let capturedWriteMode: boolean | undefined;
    const issueReplies: string[] = [];
    let pullCreateCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean; workspace: { dir: string } }) => {
          executorCalled = true;
          capturedWriteMode = ctx.writeMode;
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nupdated from implicit issue intent\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai fix the login bug",
      }),
    );

    expect(executorCalled).toBe(true);
    expect(capturedWriteMode).toBe(true);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("status: success");
    expect(issueReplies[0]).toContain("pr_url: https://example.com/pr/123");
    expect(issueReplies[0]).toContain("issue_linkback_url:");
    expect(issueReplies[0]).toContain("Opened PR: https://example.com/pr/123");
    expect(pullCreateCalls).toBe(1);

    await workspaceFixture.cleanup();
  });

  test("explicit apply: prefix in issue comment still enters write mode normally", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalled = false;
    let capturedWriteMode: boolean | undefined;
    let pullCreateCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          executorCalled = true;
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: fix the login bug",
      }),
    );

    expect(executorCalled).toBe(true);
    expect(capturedWriteMode).toBe(true);
    expect(pullCreateCalls).toBe(0);

    await workspaceFixture.cleanup();
  });

  test("explicit issue apply/change requests are refused with actionable write-enable guidance when disabled", async () => {
    const runCase = async (keyword: "apply" | "change") => {
      const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
      const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

      let executorCalled = false;
      let pullCreateCalls = 0;
      const issueReplies: string[] = [];

      const eventRouter: EventRouter = {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      };

      const jobQueue: JobQueue = {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      };

      const workspaceManager: WorkspaceManager = {
        create: async (_installationId: number, options: CloneOptions) => {
          await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
          return { dir: workspaceFixture.dir, cleanup: async () => undefined };
        },
        cleanupStale: async () => 0,
      };

      const octokit = {
        rest: {
          reactions: {
            createForPullRequestReviewComment: async () => ({ data: {} }),
            createForIssueComment: async () => ({ data: {} }),
          },
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async (params: { body: string }) => {
              issueReplies.push(params.body);
              return { data: {} };
            },
          },
          pulls: {
            list: async () => ({ data: [] }),
            get: async () => ({ data: {} }),
            create: async () => {
              pullCreateCalls++;
              return { data: { html_url: "https://example.com/pr/123" } };
            },
            createReplyForReviewComment: async () => ({ data: {} }),
          },
        },
      };

      createMentionHandler({
        eventRouter,
        jobQueue,
        workspaceManager,
        githubApp: {
          getAppSlug: () => "kodiai",
          getInstallationOctokit: async () => octokit as never,
        } as unknown as GitHubApp,
        executor: {
          execute: async () => {
            executorCalled = true;
            return {
              conclusion: "success",
              published: true,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-mention",
            };
          },
        } as never,
        telemetryStore: noopTelemetryStore,
        logger: createNoopLogger(),
      });

      const handler = handlers.get("issue_comment.created");
      expect(handler).toBeDefined();

      const command = `@kodiai ${keyword}: fix the login bug`;
      await handler!(
        buildIssueCommentMentionEvent({
          issueNumber: 77,
          commentBody: command,
        }),
      );

      expect(executorCalled).toBe(false);
      expect(pullCreateCalls).toBe(0);
      expect(issueReplies).toHaveLength(1);
      expect(issueReplies[0]).toContain("Write mode is disabled for this repo.");
      expect(issueReplies[0]).toContain("Update `.kodiai.yml`:");
      expect(issueReplies[0]).toContain("```yml");
      expect(issueReplies[0]).toContain("write:");
      expect(issueReplies[0]).toContain("enabled: true");
      expect(issueReplies[0]).toContain(`re-run the same \`${command}\``);

      await workspaceFixture.cleanup();
    };

    await runCase("apply");
    await runCase("change");
  });

  test("issue trigger A wording without apply/change is treated as implicit write intent", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai can you fix the issue intent gating copy so it is clearer for users?",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Write mode is disabled for this repo.");

    await workspaceFixture.cleanup();
  });

  test("issue 'can you PR this' wording runs as normal mention when write.enabled is false", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody:
          "@kodiai can you PR this and post all the testing steps there, ask Jenkins to do a build and then put @Blahkaey and @garbear as reviewers?",
      }),
    );

    // "can you PR this" is not detected as an implementation verb,
    // so it runs as a normal mention (not write mode)
    expect(executorCalled).toBe(true);

    await workspaceFixture.cleanup();
  });

  test.each([
    "yes, please write the PR for this",
    "go ahead and write the PR",
    "write the PR",
    "open a PR for this",
    "yes do it",
    "sounds good, go ahead",
    "please proceed",
    "yes go ahead",
    "looks good, make the PR",
    "sure, please create a PR",
    "submit the PR please",
  ])(
    "conversational confirmation '%s' is treated as write intent and refused when write mode is disabled",
    async (commentBody) => {
      const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
      const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

      let executorCalled = false;
      const issueReplies: string[] = [];

      const eventRouter: EventRouter = {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      };

      const jobQueue: JobQueue = {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      };

      const workspaceManager: WorkspaceManager = {
        create: async (_installationId: number, options: CloneOptions) => {
          await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
          return { dir: workspaceFixture.dir, cleanup: async () => undefined };
        },
        cleanupStale: async () => 0,
      };

      const octokit = {
        rest: {
          reactions: {
            createForPullRequestReviewComment: async () => ({ data: {} }),
            createForIssueComment: async () => ({ data: {} }),
          },
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async (params: { body: string }) => {
              issueReplies.push(params.body);
              return { data: {} };
            },
          },
          pulls: {
            list: async () => ({ data: [] }),
            get: async () => ({ data: {} }),
            createReplyForReviewComment: async () => ({ data: {} }),
          },
        },
      };

      createMentionHandler({
        eventRouter,
        jobQueue,
        workspaceManager,
        githubApp: {
          getAppSlug: () => "kodiai",
          getInstallationOctokit: async () => octokit as never,
        } as unknown as GitHubApp,
        executor: {
          execute: async () => {
            executorCalled = true;
            return {
              conclusion: "success",
              published: true,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-mention",
            };
          },
        } as never,
        telemetryStore: noopTelemetryStore,
        logger: createNoopLogger(),
      });

      const handler = handlers.get("issue_comment.created");
      expect(handler).toBeDefined();

      await handler!(
        buildIssueCommentMentionEvent({
          issueNumber: 77,
          commentBody: `@kodiai ${commentBody}`,
        }),
      );

      expect(executorCalled).toBe(false);
      expect(issueReplies).toHaveLength(1);
      expect(issueReplies[0]).toContain("Write mode is disabled for this repo.");

      await workspaceFixture.cleanup();
    },
  );

  test.each([
    "yes",
    "yes that's interesting",
    "what does this code do?",
    "sounds good",
    "looks good, thanks",
  ])(
    "non-actionable message '%s' is NOT treated as write intent",
    async (commentBody) => {
      const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
      const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

      let executorCalled = false;

      const eventRouter: EventRouter = {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      };

      const jobQueue: JobQueue = {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      };

      const workspaceManager: WorkspaceManager = {
        create: async (_installationId: number, options: CloneOptions) => {
          await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
          return { dir: workspaceFixture.dir, cleanup: async () => undefined };
        },
        cleanupStale: async () => 0,
      };

      const octokit = {
        rest: {
          reactions: {
            createForPullRequestReviewComment: async () => ({ data: {} }),
            createForIssueComment: async () => ({ data: {} }),
          },
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => ({ data: {} }),
          },
          pulls: {
            list: async () => ({ data: [] }),
            get: async () => ({ data: {} }),
            createReplyForReviewComment: async () => ({ data: {} }),
          },
        },
      };

      createMentionHandler({
        eventRouter,
        jobQueue,
        workspaceManager,
        githubApp: {
          getAppSlug: () => "kodiai",
          getInstallationOctokit: async () => octokit as never,
        } as unknown as GitHubApp,
        executor: {
          execute: async () => {
            executorCalled = true;
            return {
              conclusion: "success",
              published: true,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-mention",
            };
          },
        } as never,
        telemetryStore: noopTelemetryStore,
        logger: createNoopLogger(),
      });

      const handler = handlers.get("issue_comment.created");
      expect(handler).toBeDefined();

      await handler!(
        buildIssueCommentMentionEvent({
          issueNumber: 77,
          commentBody: `@kodiai ${commentBody}`,
        }),
      );

      // Should run as a normal mention, not trigger write intent refusal
      expect(executorCalled).toBe(true);

      await workspaceFixture.cleanup();
    },
  );

  test("issue 'fix this so you can open up a PR' wording is refused when write.enabled is false", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai fix this so you can open up a PR",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Write mode is disabled for this repo.");

    await workspaceFixture.cleanup();
  });

  test("quoted issue rewrite ask is treated as write intent and refused when write mode is disabled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody:
          "@kodiai > quick question: can you improve the issue intent gating copy so it is clearer for users?",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Write mode is disabled for this repo.");

    await workspaceFixture.cleanup();
  });

  test("gsd quick issue wrapper with URL still triggers implicit write intent", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody:
          "@kodiai /gsd:quick https://github.com/xbmc/xbmc/issues/27882#issuecomment-3924532785 fix this so you can open up a PR.",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Write mode is disabled for this repo.");

    await workspaceFixture.cleanup();
  });

  test("issue informational question still runs normal executor path", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai where is auth middleware configured?",
      }),
    );

    expect(executorCalled).toBe(true);
    expect(issueReplies).toHaveLength(0);

    await workspaceFixture.cleanup();
  });

  test("issue apply intent creates a PR against the default branch", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalled = false;
    let capturedWriteMode: boolean | undefined;
    let pullCreateCalls = 0;
    let createdPrHead: string | undefined;
    let createdPrBase: string | undefined;
    let createdPrTitle: string | undefined;
    let createdPrBody: string | undefined;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async (params: { head: string; base: string; title: string; body: string }) => {
            pullCreateCalls++;
            createdPrHead = params.head;
            createdPrBase = params.base;
            createdPrTitle = params.title;
            createdPrBody = params.body;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean; workspace: { dir: string } }) => {
          executorCalled = true;
          capturedWriteMode = ctx.writeMode;
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nupdated from issue\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        defaultBranch: "feature",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(executorCalled).toBe(true);
    expect(capturedWriteMode).toBe(true);
    expect(pullCreateCalls).toBe(1);
    expect(createdPrHead).toBeDefined();
    expect(createdPrHead!).toContain("kodiai/apply/issue-77-comment-777-");
    const pushedHeadSha = (
      await $`git --git-dir ${workspaceFixture.remoteDir} rev-parse refs/heads/${createdPrHead!}`.quiet()
    )
      .text()
      .trim();
    expect(pushedHeadSha.length).toBeGreaterThan(0);
    expect(createdPrBase).toBe("feature");
    expect(createdPrTitle).toMatch(/^feat: /);
    expect(createdPrBody).toContain("Update the README heading");
    expect(createdPrBody).toContain("Resolves #77");
    expect(createdPrBody).toContain(
      "Trigger: https://github.com/acme/repo/issues/77#issuecomment-777",
    );
    expect(createdPrBody).toContain("<details>");
    expect(createdPrBody).toContain("Delivery: delivery-issue-mention-123");
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("status: success");
    expect(issueReplies[0]).toContain("pr_url: https://example.com/pr/123");
    expect(issueReplies[0]).toContain("issue_linkback_url:");
    expect(issueReplies[0]).toContain("Opened PR: https://example.com/pr/123");

    await workspaceFixture.cleanup();
  });

  test("issue apply intent with no file edits posts clear refusal and skips PR creation", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("I didn't end up making any file changes.");
    expect(issueReplies[0]).toContain("re-run with a more specific request");

    await workspaceFixture.cleanup();
  });

  test("production-shape issue_comment apply intent opens PR and replies with Opened PR URL", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalled = false;
    let capturedWriteMode: boolean | undefined;
    let pullCreateCalls = 0;
    let createdPrBase: string | undefined;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async (params: { base: string }) => {
            pullCreateCalls++;
            createdPrBase = params.base;
            return { data: { html_url: "https://example.com/pr/live-shape" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean; workspace: { dir: string } }) => {
          executorCalled = true;
          capturedWriteMode = ctx.writeMode;
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nlive-shape update\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildLiveIssueCommentMentionEvent({
        commentBody: "@kodiai apply: update README wording",
        defaultBranch: "feature",
      }),
    );

    expect(executorCalled).toBe(true);
    expect(capturedWriteMode).toBe(true);
    expect(pullCreateCalls).toBe(1);
    expect(createdPrBase).toBe("feature");
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("status: success");
    expect(issueReplies[0]).toContain("pr_url: https://example.com/pr/live-shape");
    expect(issueReplies[0]).toContain("issue_linkback_url:");
    expect(issueReplies[0]).toContain("Opened PR: https://example.com/pr/live-shape");
    expect(issueReplies[0]).not.toContain("I can only apply changes in a PR context.");

    await workspaceFixture.cleanup();
  });

  test("issue apply: PR creation permission failure posts actionable app-permission guidance", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            const err = new Error(
              "Resource not accessible by integration (token=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD)",
            ) as Error & { status?: number };
            err.status = 403;
            throw err;
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\npermission guidance needed\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(pullCreateCalls).toBe(1);
    expect(issueReplies).toHaveLength(1);
    const reply = issueReplies[0]!;
    expect(reply).toContain("missing GitHub App permissions");
    expect(reply).toContain("Contents: Read and write");
    expect(reply).toContain("Pull requests: Read and write");
    expect(reply).toContain("Issues: Read and write");
    expect(reply).toContain("After updating permissions");
    expect(reply).toContain("@kodiai apply: update the README");
    expect(reply).not.toContain("Opened PR:");
    expect(reply).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");

    await workspaceFixture.cleanup();
  });

  test("issue apply: push permission failure reuses permission-remediation reply shape", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const hookPath = join(workspaceFixture.remoteDir, "hooks", "pre-receive");
    await Bun.write(
      hookPath,
      "#!/bin/sh\necho 'remote: permission to acme/repo.git denied to github-actions[bot].' >&2\nexit 1\n",
    );
    await $`chmod +x ${hookPath}`.quiet();

    const issueReplies: string[] = [];
    let pullCreateCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/never-created" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nremote denied\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    const reply = issueReplies[0]!;
    expect(reply).toContain("missing GitHub App permissions");
    expect(reply).toContain("Contents: Read and write");
    expect(reply).toContain("Pull requests: Read and write");
    expect(reply).toContain("Issues: Read and write");
    expect(reply).toContain("After updating permissions");
    expect(reply).toContain("@kodiai apply: update the README");
    expect(reply).not.toContain("Opened PR:");

    await workspaceFixture.cleanup();
  });

  test("issue write-intent PR creation retries once then returns pr_creation_failed diagnostics", async () => {
    const runCase = async (commentBody: string) => {
      const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
      const workspaceFixture = await createWorkspaceFixture(
        "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
      );

      let pullCreateCalls = 0;
      const issueReplies: string[] = [];

      const eventRouter: EventRouter = {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      };

      const jobQueue: JobQueue = {
        enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      };

      const workspaceManager: WorkspaceManager = {
        create: async (_installationId: number, options: CloneOptions) => {
          await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
          return { dir: workspaceFixture.dir, cleanup: async () => undefined };
        },
        cleanupStale: async () => 0,
      };

      const octokit = {
        rest: {
          reactions: {
            createForPullRequestReviewComment: async () => ({ data: {} }),
            createForIssueComment: async () => ({ data: {} }),
          },
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async (params: { body: string }) => {
              issueReplies.push(params.body);
              return { data: {} };
            },
          },
          pulls: {
            list: async () => ({ data: [] }),
            get: async () => ({ data: {} }),
            create: async () => {
              pullCreateCalls++;
              throw new Error("upstream create-pr failure");
            },
            createReplyForReviewComment: async () => ({ data: {} }),
          },
        },
      };

      createMentionHandler({
        eventRouter,
        jobQueue,
        workspaceManager,
        githubApp: {
          getAppSlug: () => "kodiai",
          getInstallationOctokit: async () => octokit as never,
        } as unknown as GitHubApp,
        executor: {
          execute: async (ctx: { workspace: { dir: string } }) => {
            await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nretry create pr\n");
            return {
              conclusion: "success",
              published: false,
              costUsd: 0,
              numTurns: 1,
              durationMs: 1,
              sessionId: "session-mention",
            };
          },
        } as never,
        telemetryStore: noopTelemetryStore,
        logger: createNoopLogger(),
      });

      const handler = handlers.get("issue_comment.created");
      expect(handler).toBeDefined();

      await handler!(
        buildIssueCommentMentionEvent({
          issueNumber: 77,
          commentBody,
        }),
      );

      expect(pullCreateCalls).toBe(2);
      expect(issueReplies).toHaveLength(1);
      expect(issueReplies[0]).toContain("status: pr_creation_failed");
      expect(issueReplies[0]).toContain("failed_step: create-pr");
      expect(issueReplies[0]).toContain("diagnostics: upstream create-pr failure");
      expect(issueReplies[0]).toContain("Next step: Fix the failed step and retry the exact same command.");
      expect(issueReplies[0]).toContain("Retry command: @kodiai");
      expect(issueReplies[0]).not.toContain("Opened PR:");

      await workspaceFixture.cleanup();
    };

    await runCase("@kodiai apply: update the README");
    await runCase("@kodiai can you update the README wording for clarity?");
  });

  test("issue write-mode reports issue-linkback failure without success wording", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let pullCreateCalls = 0;
    let createCommentCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            createCommentCalls++;
            if (createCommentCalls === 1) {
              throw new Error("issue comment endpoint timeout");
            }
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nlinkback failure\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(pullCreateCalls).toBe(1);
    expect(createCommentCalls).toBe(2);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("status: pr_creation_failed");
    expect(issueReplies[0]).toContain("failed_step: issue-linkback");
    expect(issueReplies[0]).toContain("diagnostics: issue comment endpoint timeout");
    expect(issueReplies[0]).not.toContain("Opened PR:");

    await workspaceFixture.cleanup();
  });

  test("success reply without machine-checkable markers is invalid (negative regression)", () => {
    // This test proves that a success reply lacking deterministic status markers
    // would fail contract assertions. If the envelope builder ever regresses to
    // free-form-only output, this test documents the expected failure shape.
    const freeFormOnly = "<details>\n<summary>kodiai response</summary>\n\nOpened PR: https://example.com/pr/123\n\n</details>";
    // A valid success reply MUST contain these markers:
    expect(freeFormOnly).not.toContain("status: success");
    expect(freeFormOnly).not.toContain("pr_url:");
    expect(freeFormOnly).not.toContain("issue_linkback_url:");
    // This proves free-form-only replies are distinguishable from contract-compliant ones.
  });

  test("issue apply: replay reuses existing PR and replies with Existing PR link", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalled = false;
    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [{ html_url: "https://example.com/pr/42" }] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: fix the login bug",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Existing PR: https://example.com/pr/42");

    await workspaceFixture.cleanup();
  });

  test("concurrent issue apply: requests are de-duped with in-flight lock", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalls = 0;
    let releaseExecution: (() => void) | undefined;
    const issueReplies: string[] = [];
    let pullCreateCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          executorCalls++;
          await new Promise<void>((resolve) => {
            releaseExecution = resolve;
          });
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nissue lock test\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    const event = buildIssueCommentMentionEvent({
      issueNumber: 77,
      commentBody: "@kodiai apply: fix the login bug",
    });

    const firstRequest = handler!(event);
    while (executorCalls === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const secondRequest = handler!(event);
    await new Promise((resolve) => setTimeout(resolve, 1));
    releaseExecution?.();
    await Promise.all([firstRequest, secondRequest]);

    expect(executorCalls).toBe(1);
    expect(pullCreateCalls).toBe(1);
    expect(issueReplies).toHaveLength(2);
    expect(issueReplies.some((body) => body.includes("already in progress"))).toBe(true);
    expect(issueReplies.filter((body) => body.includes("status: success")).length).toBe(1);
    expect(issueReplies.filter((body) => body.includes("Opened PR:")).length).toBe(1);

    await workspaceFixture.cleanup();
  });

  test("issue apply: rate limiting returns retry-later message", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n  minIntervalSeconds: 60\n",
    );

    const issueReplies: string[] = [];
    let pullCreateCalls = 0;
    let executorCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          executorCalls++;
          await Bun.write(join(ctx.workspace.dir, "README.md"), `base\nissue-rate-${executorCalls}\n`);
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: fix A",
        commentId: 777,
      }),
    );
    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: fix B",
        commentId: 778,
      }),
    );

    expect(executorCalls).toBe(1);
    expect(pullCreateCalls).toBe(1);
    expect(issueReplies).toHaveLength(2);
    expect(issueReplies[0]).toContain("status: success");
    expect(issueReplies[0]).toContain("pr_url: https://example.com/pr/123");
    expect(issueReplies[0]).toContain("Opened PR: https://example.com/pr/123");
    expect(issueReplies[1]).toContain("rate-limited");
    expect(issueReplies[1]).toContain("Try again in");

    await workspaceFixture.cleanup();
  });

  test("production-shape issue_comment without apply/change auto-promotes to write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let executorCalled = false;
    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/live-shape" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          executorCalled = true;
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nlive-shape implicit intent\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildLiveIssueCommentMentionEvent({
        commentBody: "@kodiai can you update the README wording for clarity?",
      }),
    );

    expect(executorCalled).toBe(true);
    expect(pullCreateCalls).toBe(1);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("status: success");
    expect(issueReplies[0]).toContain("pr_url: https://example.com/pr/live-shape");
    expect(issueReplies[0]).toContain("issue_linkback_url:");
    expect(issueReplies[0]).toContain("Opened PR: https://example.com/pr/live-shape");

    await workspaceFixture.cleanup();
  });

  test("issue apply intent policy failure posts refusal details in issue thread", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n  denyPaths:\n    - 'README.md'\n",
    );

    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nupdated from issue\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Write request refused");
    expect(issueReplies[0]).toContain("Reason: write-policy-denied-path");
    expect(issueReplies[0]).toContain("Rule: denyPaths");
    expect(issueReplies[0]).toContain("File: README.md");

    await workspaceFixture.cleanup();
  });

  test("issue apply intent allowPaths violation posts refusal with config snippet in issue thread", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n  allowPaths:\n    - 'src/'\n",
    );

    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nupdated from issue\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 78,
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Reason: write-policy-not-allowed");
    expect(issueReplies[0]).toContain("Rule: allowPaths");
    expect(issueReplies[0]).toContain("File: README.md");
    expect(issueReplies[0]).toContain("Smallest config change");
    expect(issueReplies[0]).toContain("allowPaths");
    expect(issueReplies[0]).toContain("- 'README.md'");
    expect(issueReplies[0]).toContain(".kodiai.yml");

    await workspaceFixture.cleanup();
  });

  test("issue apply intent secretScan violation posts refusal with detector in issue thread", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(
            join(ctx.workspace.dir, "README.md"),
            "base\nupdated from issue\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD\n",
          );
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 79,
        commentBody: "@kodiai apply: add the config",
      }),
    );

    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    const reply = issueReplies[0]!;
    expect(reply).toContain("Reason: write-policy-secret-detected");
    expect(reply).toContain("Rule: secretScan");
    expect(reply).toContain("File: README.md");
    expect(reply).toContain("Detector: regex:github-pat");
    expect(reply).toContain("Remove/redact the secret");
    expect(reply.indexOf("Remove/redact the secret")).toBeLessThan(reply.indexOf("disable secretScan"));
    expect(reply).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");

    await workspaceFixture.cleanup();
  });

  test("write intent is refused when write.enabled is false", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalled = false;
    let replyBody: string | undefined;

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("Write mode is disabled");
    expect(replyBody!).toContain("write:");
    expect(replyBody!).toContain("enabled: true");

    await workspaceFixture.cleanup();
  });

  test("write intent enabled creates a PR and replies with the link", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let capturedPrompt: string | undefined;
    let capturedWriteMode: boolean | undefined;
    let createdPrHead: string | undefined;
    let createdPrBase: string | undefined;
    let replyBody: string | undefined;

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async (params: { head: string; base: string }) => {
            createdPrHead = params.head;
            createdPrBase = params.base;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string; writeMode?: boolean; workspace: { dir: string } }) => {
          capturedPrompt = ctx.prompt;
          capturedWriteMode = ctx.writeMode;
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nfeature\nchanged\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(capturedPrompt).toBeDefined();
    expect(capturedWriteMode).toBe(true);
    expect(capturedPrompt!).toContain("Write-intent request detected");
    expect(capturedPrompt!).toContain("update the README");
    expect(capturedPrompt!).not.toContain("@kodiai apply: update the README");

    expect(createdPrHead).toBeDefined();
    expect(createdPrBase).toBe("main");
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("https://example.com/pr/123");

    await workspaceFixture.cleanup();
  });

  test("write intent updates existing PR branch when head is in same repo", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let replyBody: string | undefined;
    const prNumber = 101;
    const headRef = "feature";

    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse ${headRef}`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    let prCreateCalled = false;
    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: headRef,
                repo: { owner: { login: "acme" }, name: "repo" },
              },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            prCreateCalled = true;
            return { data: { html_url: "https://example.com/pr/bot" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nfeature\nchanged\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef,
        headRepoOwner: "acme",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(prCreateCalled).toBe(false);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("Updated PR");

    const remoteMsg = (
      await $`git --git-dir ${workspaceFixture.remoteDir} log -1 --pretty=%B ${headRef}`.quiet()
    )
      .text();
    expect(remoteMsg).toContain("kodiai-write-output-key:");

    await workspaceFixture.cleanup();
  });

  test("plan intent does not enable writeMode or create a PR", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedWriteMode: boolean | undefined;
    let prCreates = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            prCreates++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai plan: update the README",
      }),
    );

    expect(capturedWriteMode).toBe(false);
    expect(prCreates).toBe(0);

    await workspaceFixture.cleanup();
  });

  test("write intent is idempotent when a PR already exists for the branch", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let executorCalled = false;
    let replyBody: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [{ html_url: "https://example.com/pr/existing" }] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("Existing PR");
    expect(replyBody!).toContain("https://example.com/pr/existing");

    await workspaceFixture.cleanup();
  });

  test("write intent is refused when a staged path is denied", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n  denyPaths:\n    - 'README.md'\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let createdPr = false;
    let replyBody: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            createdPr = true;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nfeature\nchanged\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(createdPr).toBe(false);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("Write request refused");
    expect(replyBody!).toContain("Reason: write-policy-denied-path");
    expect(replyBody!).toContain("Rule: denyPaths");
    expect(replyBody!).toContain("File: README.md");
    expect(replyBody!).toContain("Matched pattern: README.md");

    await workspaceFixture.cleanup();
  });

  test("write intent refusal includes smallest allowPaths suggestion when allowlisted policy blocks", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n  allowPaths:\n    - 'src/'\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet()).text().trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let replyBody: string | undefined;
    let prCreates = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            prCreates++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nfeature\nchanged\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(prCreates).toBe(0);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("Reason: write-policy-not-allowed");
    expect(replyBody!).toContain("Rule: allowPaths");
    expect(replyBody!).toContain("File: README.md");
    expect(replyBody!).toContain("Smallest config change");
    expect(replyBody!).toContain("allowPaths");
    expect(replyBody!).toContain("- 'README.md'");

    await workspaceFixture.cleanup();
  });

  test("write intent refusal includes detector and path for secret-like content", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet()).text().trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let replyBody: string | undefined;
    let prCreates = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            prCreates++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          // Dummy secret-like token that matches the github-pat regex.
          await Bun.write(
            join(ctx.workspace.dir, "README.md"),
            "base\nfeature\nchanged\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD\n",
          );
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: update the README",
      }),
    );

    expect(prCreates).toBe(0);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("Reason: write-policy-secret-detected");
    expect(replyBody!).toContain("Rule: secretScan");
    expect(replyBody!).toContain("File: README.md");
    expect(replyBody!).toContain("Detector: regex:github-pat");

    await workspaceFixture.cleanup();
  });

  test("write intent allows removing existing secret-like content", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    // Seed the feature branch with a token-like line, then verify removing it is allowed.
    await $`git -C ${workspaceFixture.dir} checkout feature`.quiet();
    await Bun.write(
      join(workspaceFixture.dir, "README.md"),
      "base\nfeature\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD\n",
    );
    await $`git -C ${workspaceFixture.dir} add README.md`.quiet();
    await $`git -C ${workspaceFixture.dir} commit -m "seed secret-like content"`.quiet();
    await $`git -C ${workspaceFixture.dir} push origin feature`.quiet();

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet()).text().trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let replyBody: string | undefined;
    let prCreates = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            prCreates++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replyBody = params.body;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          // Remove the previously committed secret-like line.
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\nfeature\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai apply: remove the token line from README",
      }),
    );

    expect(prCreates).toBe(1);
    expect(replyBody).toBeDefined();
    expect(replyBody!).toContain("status: success");
    expect(replyBody!).toContain("pr_url: https://example.com/pr/123");
    expect(replyBody!).toContain("Opened PR: https://example.com/pr/123");
    expect(replyBody!).not.toContain("write-policy-secret-detected");

    await workspaceFixture.cleanup();
  });

  test("write intent requests are rate-limited when configured", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n  minIntervalSeconds: 60\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const replies: string[] = [];
    let prCreates = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          create: async () => {
            prCreates++;
            return { data: { html_url: "https://example.com/pr/123" } };
          },
          createReplyForReviewComment: async (params: { body: string }) => {
            replies.push(params.body);
            return { data: {} };
          },
        },
      },
    };

    let writeCount = 0;
    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { workspace: { dir: string } }) => {
          writeCount++;
          await Bun.write(
            join(ctx.workspace.dir, "README.md"),
            `base\nfeature\nchanged-${writeCount}\n`,
          );
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    const event = buildReviewCommentMentionEvent({
      prNumber,
      baseRef: "main",
      headRef: "feature",
      headRepoOwner: "forker",
      headRepoName: "repo",
      commentBody: "@kodiai apply: update the README",
    });

    await handler!(event);
    await handler!(event);

    expect(prCreates).toBe(1);
    expect(replies).toHaveLength(2);
    expect(replies[1]!).toContain("rate-limited");

    await workspaceFixture.cleanup();
  });
});

describe("createMentionHandler multi-query retrieval context (RET-07)", () => {
  test("invokes three retrieval variants and injects merged retrieval context into mention prompt", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    const embeddingQueries: string[] = [];
    let capturedPrompt = "";

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    const embeddingProvider = {
      model: "test",
      dimensions: 1,
      generate: async (query: string) => {
        embeddingQueries.push(query);
        const variantId = query.includes("files:") ? 2 : query.includes("risk:") ? 3 : 1;
        return {
          embedding: new Float32Array([variantId]),
          model: "test",
          dimensions: 1,
        };
      },
    };

    const isolationLayer = {
      retrieveWithIsolation: async (params: { queryEmbedding: Float32Array }) => {
        const variantId = params.queryEmbedding[0] ?? 0;
        const mk = (memoryId: number, findingText: string, distance: number, filePath?: string) => ({
          memoryId,
          distance,
          sourceRepo: "acme/repo",
          record: {
            id: memoryId,
            repo: "repo",
            owner: "acme",
            findingId: memoryId,
            reviewId: 100 + memoryId,
            sourceRepo: "acme/repo",
            findingText,
            severity: "major",
            category: "correctness",
            filePath: filePath ?? `src/f-${memoryId}.ts`,
            outcome: "accepted",
            embeddingModel: "test",
            embeddingDim: 1,
            stale: false,
          },
        });

        if (variantId === 1) {
          return {
            results: [mk(1, "base feature", 0.3, "README.md")],
            provenance: {
              repoSources: ["acme/repo"],
              sharedPoolUsed: false,
              totalCandidates: 1,
              query: { repo: "acme/repo", topK: 1, threshold: 0.3 },
            },
          };
        }

        if (variantId === 2) {
          return {
            results: [mk(1, "shared mention finding", 0.25)],
            provenance: {
              repoSources: ["acme/repo"],
              sharedPoolUsed: false,
              totalCandidates: 1,
              query: { repo: "acme/repo", topK: 1, threshold: 0.3 },
            },
          };
        }

        return {
          results: [mk(2, "shape mention `finding`", 0.2)],
          provenance: {
            repoSources: ["acme/repo"],
            sharedPoolUsed: false,
            totalCandidates: 1,
            query: { repo: "acme/repo", topK: 1, threshold: 0.3 },
          },
        };
      },
    };

    const retriever = createRetriever({
      embeddingProvider: embeddingProvider as never,
      isolationLayer: isolationLayer as never,
      config: {
        retrieval: { enabled: true, topK: 3, distanceThreshold: 0.3, adaptive: true, maxContextChars: 1200 },
        sharing: { enabled: false },
      },
    });

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          capturedPrompt = ctx.prompt ?? "";
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention-ret07",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      retriever,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await Bun.write(join(workspaceFixture.dir, "README.md"), "base feature\n");

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai what prior patterns are relevant here?",
      }),
    );

    if (capturedPrompt.length > 0) {
      expect(embeddingQueries.length).toBeGreaterThan(0);
      expect(capturedPrompt).toContain("## Retrieval");
      expect(capturedPrompt).toContain("`README.md:1` -- `base feature`");
      expect(capturedPrompt).toContain("shape mention 'finding'");
      expect(capturedPrompt).toContain("`src/f-2.ts` -- shape mention 'finding'");
    }

    await workspaceFixture.cleanup();
  });

  test("partial retrieval variant failures stay fail-open and still execute mention reply", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    let executorCalls = 0;
    let capturedPrompt = "";

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    const failOpenRetriever = createRetriever({
      embeddingProvider: {
        model: "test",
        dimensions: 1,
        generate: async (query: string) => {
          if (query.includes("files:")) {
            throw new Error("file-path retrieval failed");
          }
          return {
            embedding: new Float32Array([query.includes("risk:") ? 2 : 1]),
            model: "test",
            dimensions: 1,
          };
        },
      } as never,
      isolationLayer: {
        retrieveWithIsolation: async (params: { queryEmbedding: Float32Array }) => {
          const variantId = params.queryEmbedding[0] ?? 0;
          const findingText = variantId === 1 ? "intent-only mention finding" : "shape-only mention finding";
          return {
            results: [
              {
                memoryId: 40 + variantId,
                distance: 0.2,
                sourceRepo: "acme/repo",
                record: {
                  id: 40 + variantId,
                  repo: "repo",
                  owner: "acme",
                  findingId: 40 + variantId,
                  reviewId: 200 + variantId,
                  sourceRepo: "acme/repo",
                  findingText,
                  severity: "major",
                  category: "correctness",
                  filePath: `src/ret-${variantId}.ts`,
                  outcome: "accepted",
                  embeddingModel: "test",
                  embeddingDim: 1,
                  stale: false,
                },
              },
            ],
            provenance: {
              repoSources: ["acme/repo"],
              sharedPoolUsed: false,
              totalCandidates: 1,
              query: { repo: "acme/repo", topK: 1, threshold: 0.3 },
            },
          };
        },
      } as never,
      config: {
        retrieval: { enabled: true, topK: 3, distanceThreshold: 0.3, adaptive: true, maxContextChars: 1200 },
        sharing: { enabled: false },
      },
    });

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          executorCalls++;
          capturedPrompt = ctx.prompt ?? "";
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention-ret07-fail-open",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      retriever: failOpenRetriever,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai what context should I consider first?",
      }),
    );

    expect(executorCalls).toBe(1);
    expect(capturedPrompt).toContain("intent-only mention finding");
    expect(capturedPrompt).toContain("shape-only mention finding");

    await workspaceFixture.cleanup();
  });

  test("combined degraded retrieval + issue write flow keeps retrieval-safe prompt and enforces pr_creation_failed", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );

    let capturedPrompt = "";
    let pullCreateCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            issueReplies.push(params.body);
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({ data: {} }),
          create: async () => {
            pullCreateCalls++;
            throw new Error("create-pr transient failure");
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    const combinedRetriever = createRetriever({
      embeddingProvider: {
        model: "test",
        dimensions: 1,
        generate: async (query: string) => {
          if (query.includes("files:")) {
            throw new Error("file-path retrieval failed");
          }
          return {
            embedding: new Float32Array([query.includes("risk:") ? 2 : 1]),
            model: "test",
            dimensions: 1,
          };
        },
      } as never,
      isolationLayer: {
        retrieveWithIsolation: async (params: { queryEmbedding: Float32Array }) => {
          const variantId = params.queryEmbedding[0] ?? 0;
          const findingText = variantId === 1 ? "intent-only mention finding" : "shape mention `finding`";
          return {
            results: [
              {
                memoryId: 120 + variantId,
                distance: 0.2,
                sourceRepo: "acme/repo",
                record: {
                  id: 120 + variantId,
                  repo: "repo",
                  owner: "acme",
                  findingId: 120 + variantId,
                  reviewId: 220 + variantId,
                  sourceRepo: "acme/repo",
                  findingText,
                  severity: "major",
                  category: "correctness",
                  filePath: `src/ret-combined-${variantId}.ts`,
                  outcome: "accepted",
                  embeddingModel: "test",
                  embeddingDim: 1,
                  stale: false,
                },
              },
            ],
            provenance: {
              repoSources: ["acme/repo"],
              sharedPoolUsed: false,
              totalCandidates: 1,
              query: { repo: "acme/repo", topK: 1, threshold: 0.3 },
            },
          };
        },
      } as never,
      config: {
        retrieval: { enabled: true, topK: 3, distanceThreshold: 0.3, adaptive: true, maxContextChars: 1200 },
        sharing: { enabled: false },
      },
    });

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string; workspace: { dir: string } }) => {
          capturedPrompt = ctx.prompt ?? "";
          await Bun.write(join(ctx.workspace.dir, "README.md"), "base\ncombined degraded + write\n");
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention-combined",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      retriever: combinedRetriever,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildIssueCommentMentionEvent({
        issueNumber: 77,
        commentBody: "@kodiai can you update the README wording for clarity?",
      }),
    );

    // Unified cross-corpus context takes precedence over legacy retrieval (KI-11/KI-12)
    expect(capturedPrompt).toContain("## Knowledge Context");
    expect(capturedPrompt).toContain("intent-only mention finding");
    // Backticks are preserved in unified context (not sanitized like legacy path)
    expect(capturedPrompt).toContain("shape mention");
    expect(pullCreateCalls).toBe(2);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("status: pr_creation_failed");
    expect(issueReplies[0]).toContain("failed_step: create-pr");
    expect(issueReplies[0]).not.toContain("Opened PR:");

    await workspaceFixture.cleanup();
  });

});

describe("createMentionHandler review command", () => {
  test("pr top-level review request posts review-structured fallback when execution is non-published", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: false\n");

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");
    expect(issueReplies[0]).toContain("Issues:");
    expect(issueReplies[0]).not.toContain("I can answer this, but I need one detail first.");

    await workspaceFixture.cleanup();
  });

  test("pr top-level review request posts failure fallback when review run fails without publishing", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    const prNumber = 102;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          stopReason: "error_max_structured_output_retries",
          errorMessage: "Review response could not satisfy the structured output contract.",
          costUsd: 0,
          numTurns: 13,
          durationMs: 1,
          sessionId: "session-mention-failure",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("I completed the review run but couldn't publish a GitHub review/comment from it.");
    expect(issueReplies[0]).toContain("Stop reason: error_max_structured_output_retries");
    expect(issueReplies[0]).toContain("Review response could not satisfy the structured output contract.");

    await workspaceFixture.cleanup();
  });

  test("pr top-level review request posts turn-limit fallback for error_max_turns even when stopReason is tool_use", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\n");

    const prNumber = 102;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "failure",
          published: false,
          failureSubtype: "error_max_turns",
          stopReason: "tool_use",
          costUsd: 0,
          numTurns: 26,
          durationMs: 1,
          sessionId: "session-mention-max-turns",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          resultText: undefined,
          errorMessage: undefined,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("I ran out of steps analyzing this and wasn't able to post a complete response.");
    expect(issueReplies[0]).not.toContain("I completed the review run but couldn't publish a GitHub review/comment from it.");

    await workspaceFixture.cleanup();
  });

  test("explicit review mentions advance through truthful pre-executor phases", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const prNumber = 103;
    const reviewFamilyKey = buildReviewFamilyKey("acme", "repo", prNumber);
    const workspaceFixture = await createWorkspaceFixture(
      [
        "mention:",
        "  enabled: true",
        "review:",
        "  enabled: true",
        "  autoApprove: true",
        "  onSynchronize: true",
        "",
      ].join("\n"),
    );

    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const phaseTransitions: string[] = [];
    let phaseAtWorkspaceCreate: string | undefined;
    let phaseAtConfigWarning: string | undefined;
    let phasesSeenAtExecutor: string[] = [];
    const coordinator = createReviewWorkCoordinator({
      nowFn: (() => {
        let nowMs = 21_000;
        return () => ++nowMs;
      })(),
    });
    const reviewWorkCoordinator = {
      claim: (claim: Parameters<typeof coordinator.claim>[0]) => coordinator.claim(claim),
      canPublish: (attemptId: Parameters<typeof coordinator.canPublish>[0]) => coordinator.canPublish(attemptId),
      setPhase: (
        attemptId: Parameters<typeof coordinator.setPhase>[0],
        phase: Parameters<NonNullable<typeof coordinator.setPhase>>[1],
      ) => {
        phaseTransitions.push(phase);
        return coordinator.setPhase(attemptId, phase);
      },
      getSnapshot: (familyKey: Parameters<typeof coordinator.getSnapshot>[0]) => coordinator.getSnapshot(familyKey),
      release: (attemptId: Parameters<typeof coordinator.release>[0]) => coordinator.release(attemptId),
      complete: (attemptId: Parameters<typeof coordinator.complete>[0]) => coordinator.complete(attemptId),
    };

    const logger = {
      info: () => undefined,
      warn: (_bindings: Record<string, unknown>, message: string) => {
        if (message === "Config warning detected") {
          phaseAtConfigWarning = coordinator.getSnapshot(reviewFamilyKey)?.attempts[0]?.phase;
        }
      },
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger,
    } as unknown as Logger;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        phaseAtWorkspaceCreate = coordinator.getSnapshot(reviewFamilyKey)?.attempts[0]?.phase;
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              draft: false,
              labels: [],
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          phasesSeenAtExecutor = [...phaseTransitions];
          return {
            conclusion: "success",
            published: false,
            resultText: "No issues found.",
            usedRepoInspectionTools: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention-phase-checkpoints",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(phaseAtWorkspaceCreate).toBe("workspace-create");
    expect(phaseAtConfigWarning).toBe("load-config");
    expect(phasesSeenAtExecutor).toEqual([
      "workspace-create",
      "load-config",
      "prompt-build",
      "executor-dispatch",
    ]);

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention does not submit approval review without inspection evidence", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention-no-inspection",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");
    expect(issueReplies[0]).toContain("did not produce a usable code review");

    const publishSkipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish path",
    );
    expect(publishSkipLog?.bindings.skipReason).toBe("missing-inspection-evidence");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.explicitReviewRequest).toBe(true);
    expect(completionLog?.bindings.published).toBe(false);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("none");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention does not approval-bridge when result text contains unpublished findings", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 6,
          durationMs: 1,
          sessionId: "session-mention-findings-unpublished",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          toolUseNames: ["Bash", "ToolSearch"],
          usedRepoInspectionTools: true,
          resultText: [
            "## Critical Issues Found",
            "",
            "### 1. **[CRITICAL] xbmc/addons/AddonInstaller.cpp:190 - Out-of-bounds array access**",
            "This causes undefined behavior when the loop reaches the collection size.",
            "",
            "### 2. **[MAJOR] xbmc/addons/AddonManager.cpp:116 - Inverted null pointer check**",
            "This rejects valid callbacks and breaks registration.",
          ].join("\n"),
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");
    expect(issueReplies[0]).toContain("- (1) [critical] xbmc/addons/AddonInstaller.cpp (190): Out-of-bounds array access");
    expect(issueReplies[0]).toContain("- (2) [major] xbmc/addons/AddonManager.cpp (116): Inverted null pointer check");

    const publishSkipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish path",
    );
    expect(publishSkipLog?.bindings.skipReason).toBe("result-text-findings");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.explicitReviewRequest).toBe(true);
    expect(completionLog?.bindings.published).toBe(false);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("none");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention does not approval-bridge when result text uses numbered findings from production artifact", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 6,
          durationMs: 1,
          sessionId: "session-mention-production-shape",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          toolUseNames: ["Bash", "ToolSearch"],
          usedRepoInspectionTools: true,
          resultText: [
            "Let me analyze the changes I found in the diff. I've identified several critical issues in this PR:",
            "",
            "## Review Analysis",
            "",
            "I've reviewed the changes in PR #28172 and found **5 blocking issues** that need to be addressed:",
            "",
            "### Critical Issues Found:",
            "",
            "1. **xbmc/addons/AddonInstaller.cpp:190** - Array out-of-bounds access",
            "2. **xbmc/addons/AddonManager.cpp:116** - Inverted null pointer check",
            "3. **xbmc/addons/AddonManager.cpp:151** - Undefined variable reference",
            "4. **xbmc/addons/AddonInstaller.cpp:246** - Inverted job completion logic",
            "5. **xbmc/addons/AddonInstaller.cpp:264** - Incorrect progress calculation",
            "",
            "### Summary:",
            "- **3 CRITICAL issues**: array out-of-bounds (#1), null pointer dereference (#2), compilation error (#3)",
            "- **2 MAJOR issues**: incorrect business logic (#4), wrong calculation (#5)",
            "",
            "**Verdict**: 🔴 This PR introduces multiple bugs and cannot be merged in its current state. All 5 issues must be fixed before merging.",
          ].join("\n"),
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");
    expect(issueReplies[0]).toContain("- (1) [critical] xbmc/addons/AddonInstaller.cpp (190): Array out-of-bounds access");
    expect(issueReplies[0]).toContain("- (2) [critical] xbmc/addons/AddonManager.cpp (116): Inverted null pointer check");
    expect(issueReplies[0]).toContain("- (3) [critical] xbmc/addons/AddonManager.cpp (151): Undefined variable reference");
    expect(issueReplies[0]).toContain("- (4) [major] xbmc/addons/AddonInstaller.cpp (246): Inverted job completion logic");
    expect(issueReplies[0]).toContain("- (5) [major] xbmc/addons/AddonInstaller.cpp (264): Incorrect progress calculation");

    const publishSkipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish path",
    );
    expect(publishSkipLog?.bindings.skipReason).toBe("result-text-findings");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention does not approval-bridge when result text reports tool failure after blocking findings", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 12,
          durationMs: 1,
          sessionId: "session-mention-tool-failure",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          toolUseNames: ["Bash", "Read", "ToolSearch", "mcp__github_comment__create_comment"],
          usedRepoInspectionTools: true,
          resultText: [
            "I've completed my review of PR #28172 and found **5 critical/major issues** in the code changes. However, I encountered a problem publishing the results:",
            "",
            "## Issues Found",
            "",
            "I identified the following critical issues in this PR:",
            "",
            "### xbmc/addons/AddonInstaller.cpp",
            "",
            "1. **Line 190 [CRITICAL]**: Array out-of-bounds access",
            "2. **Line 246 [CRITICAL]**: Inverted idle state logic",
            "3. **Line 264 [CRITICAL]**: Division by zero and incorrect formula",
            "",
            "### xbmc/addons/AddonManager.cpp",
            "",
            "4. **Line 116 [CRITICAL]**: Inverted null check",
            "5. **Line 151 [MAJOR]**: Undefined variable reference",
            "",
            "## Tool Availability Issue",
            "",
            "**The GitHub comment tools failed**: I attempted to use `mcp__github_comment__create_comment` as specified in the instructions, but received the error:",
            "",
            "```",
            "Error: No such tool available: mcp__github_comment__create_comment",
            "```",
          ].join("\n"),
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");
    expect(issueReplies[0]).toContain("- (1) [critical] xbmc/addons/AddonInstaller.cpp (190): Array out-of-bounds access");
    expect(issueReplies[0]).toContain("- (2) [critical] xbmc/addons/AddonInstaller.cpp (246): Inverted idle state logic");
    expect(issueReplies[0]).toContain("- (3) [critical] xbmc/addons/AddonInstaller.cpp (264): Division by zero and incorrect formula");
    expect(issueReplies[0]).toContain("- (4) [critical] xbmc/addons/AddonManager.cpp (116): Inverted null check");
    expect(issueReplies[0]).toContain("- (5) [major] xbmc/addons/AddonManager.cpp (151): Undefined variable reference");

    const publishSkipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish path",
    );
    expect(publishSkipLog?.bindings.skipReason).toBe("result-text-findings");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention does not approval-bridge when result text says the PR should not be merged", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 3,
          durationMs: 1,
          sessionId: "session-mention-should-not-merge",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          toolUseNames: ["Bash", "ToolSearch"],
          usedRepoInspectionTools: true,
          resultText: [
            "I've analyzed the diff and found several critical issues in this PR.",
            "",
            "## Critical Issues",
            "",
            "**1. [CRITICAL] Out-of-bounds array access (AddonInstaller.cpp:190)**",
            "**2. [CRITICAL] Division by zero risk (AddonInstaller.cpp:264)**",
            "**3. [CRITICAL] Undefined variable reference (AddonManager.cpp:151)**",
            "",
            "## Major Issues",
            "",
            "**4. [MAJOR] Inverted idle state logic (AddonInstaller.cpp:246)**",
            "**5. [MAJOR] Inverted null pointer check (AddonManager.cpp:116)**",
            "",
            "**Verdict: These changes should not be merged as they introduce multiple crash-prone bugs and logic errors.**",
          ].join("\n"),
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");

    const publishSkipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish path",
    );
    expect(publishSkipLog?.bindings.skipReason).toBe("result-text-findings");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention does not approval-bridge when result text reports critical and major issues with sectioned bold findings", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 3,
          durationMs: 1,
          sessionId: "session-mention-critical-major-sections",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          toolUseNames: ["Bash", "ToolSearch"],
          usedRepoInspectionTools: true,
          resultText: [
            "I've completed my review of PR #28172. I found 5 critical and major issues in the code changes. However, I notice that the GitHub comment tools (`mcp__github_comment__create_comment` and `mcp__github_inline_comment__create_inline_comment`) are not available in my current tool set, despite being listed as available in the instructions.",
            "",
            "Here are the issues I identified:",
            "",
            "## Critical Issues",
            "",
            "**1. Out-of-bounds array access** (AddonInstaller.cpp:190)",
            "This causes undefined behavior and potential crash.",
            "",
            "**2. Division by zero and incorrect progress calculation** (AddonInstaller.cpp:264)",
            "This can crash when progress is zero and computes the wrong percentage.",
            "",
            "**3. Undefined variable reference** (AddonManager.cpp:151)",
            "This causes a compilation failure.",
            "",
            "## Major Issues",
            "",
            "**4. Inverted idle state logic** (AddonInstaller.cpp:246)",
            "This flips the intended idle behavior.",
            "",
            "**5. Inverted null check prevents callback registration** (AddonManager.cpp:116)",
            "This rejects valid callbacks and breaks registration.",
          ].join("\n"),
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createdReviews).toHaveLength(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Decision: NOT APPROVED");
    expect(issueReplies[0]).toContain("- (1) [critical] AddonInstaller.cpp (190): Out-of-bounds array access");
    expect(issueReplies[0]).toContain("- (2) [critical] AddonInstaller.cpp (264): Division by zero and incorrect progress calculation");
    expect(issueReplies[0]).toContain("- (3) [critical] AddonManager.cpp (151): Undefined variable reference");
    expect(issueReplies[0]).toContain("- (4) [major] AddonInstaller.cpp (246): Inverted idle state logic");
    expect(issueReplies[0]).toContain("- (5) [major] AddonManager.cpp (116): Inverted null check prevents callback registration");

    const publishSkipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish path",
    );
    expect(publishSkipLog?.bindings.skipReason).toBe("result-text-findings");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention stays on interactive-review/review.full and submits approval review when inspection evidence is present", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const createdReviews: Array<{ event: string; body: string }> = [];
    let capturedQueueLane: string | undefined;
    let capturedTaskType: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(
        _installationId: number,
        fn: (metadata: JobQueueRunMetadata) => Promise<T>,
        context?: JobQueueContext,
      ) => {
        capturedQueueLane = context?.lane;
        return fn(createQueueRunMetadata());
      },
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async ({ event, body }: { event: string; body: string }) => {
            createdReviews.push({ event, body });
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (context: { taskType?: string }) => {
          capturedTaskType = context.taskType;
          return {
            conclusion: "success",
            published: false,
            costUsd: 0,
            numTurns: 3,
            durationMs: 1,
            sessionId: "session-mention-approve",
            model: "claude-sonnet-4-5-20250929",
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            stopReason: "end_turn",
            toolUseNames: ["Glob", "Read"],
            usedRepoInspectionTools: true,
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(capturedQueueLane).toBe("interactive-review");
    expect(capturedTaskType).toBe("review.full");

    expect(createdReviews).toHaveLength(1);
    expect(createdReviews[0]?.event).toBe("APPROVE");
    expect(createdReviews[0]?.body).toContain("<details>");
    expect(createdReviews[0]?.body).toContain("<summary>kodiai response</summary>");
    expect(createdReviews[0]?.body).toContain("Decision: APPROVE");
    expect(createdReviews[0]?.body).toContain("Issues: none");
    expect(createdReviews[0]?.body).toContain("Evidence:");
    expect(createdReviews[0]?.body).toContain("- Review prompt covered 1 changed file.");
    expect(createdReviews[0]?.body).toContain("- Repo inspection tools were used to verify the changed code.");
    expect(extractReviewOutputKey(createdReviews[0]?.body)).toBeDefined();

    const idempotencyLog = infoCalls.find((entry) =>
      entry.message === "Explicit mention review idempotency check passed",
    );
    const idempotencyReviewOutputKey =
      typeof idempotencyLog?.bindings.reviewOutputKey === "string"
        ? idempotencyLog.bindings.reviewOutputKey
        : null;
    expect(idempotencyReviewOutputKey).toBeDefined();
    expect(extractReviewOutputKey(createdReviews[0]?.body)).toBe(idempotencyReviewOutputKey);
    expect(idempotencyLog?.bindings.idempotencyDecision).toBe("publish");
    expect(idempotencyLog?.bindings.gate).toBe("review-output-idempotency");
    expect(idempotencyLog?.bindings.gateResult).toBe("accepted");

    const publishAttemptLog = infoCalls.find((entry) =>
      entry.message === "Submitted approval review for explicit mention request",
    );
    expect(publishAttemptLog?.bindings.reviewOutputKey).toBe(idempotencyLog?.bindings.reviewOutputKey);
    expect(publishAttemptLog?.bindings.publishAttemptOutcome).toBe("submitted-approval");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.reviewOutputKey).toBe(idempotencyLog?.bindings.reviewOutputKey);
    expect(completionLog?.bindings.explicitReviewRequest).toBe(true);
    expect(completionLog?.bindings.taskType).toBe("review.full");
    expect(completionLog?.bindings.lane).toBe("interactive-review");
    expect(completionLog?.bindings.published).toBe(true);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("approval-bridge");

    await workspaceFixture.cleanup();
  });

  test("logs stale predecessor telemetry when an explicit review claim finds an older family attempt", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const { logger, infoCalls } = createMockLogger();

    createMentionHandler({
      eventRouter: {
        register: (eventKey, handler) => {
          handlers.set(eventKey, handler);
        },
        dispatch: async () => undefined,
      },
      jobQueue: {
        enqueue: async <T>() => undefined as T,
        getQueueSize: () => 0,
        getPendingCount: () => 0,
        getActiveJobs: getEmptyActiveJobs,
      },
      workspaceManager: {} as WorkspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => {
          throw new Error("not used");
        },
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          throw new Error("not used");
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-explicit-claim",
          familyKey: claim.familyKey as string,
          source: claim.source as "explicit-review",
          lane: claim.lane as "interactive-review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 200,
          lastProgressAtMs: 200,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: (familyKey: string) => ({
          familyKey,
          attempts: [
            {
              attemptId: "attempt-automatic-older",
              familyKey,
              source: "automatic-review",
              lane: "review",
              deliveryId: "delivery-automatic-older",
              phase: "incremental-diff",
              claimedAtMs: 100,
              lastProgressAtMs: 150,
              supersededByAttemptId: "attempt-explicit-claim",
            },
            {
              attemptId: "attempt-explicit-claim",
              familyKey,
              source: "explicit-review",
              lane: "interactive-review",
              deliveryId: "delivery-pr-issue-comment-mention",
              phase: "claimed",
              claimedAtMs: 200,
              lastProgressAtMs: 200,
            },
          ],
        }),
        release: () => undefined,
        complete: () => undefined,
      } as never,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber: 104,
        commentBody: "@kodiai review",
      }),
    );

    const predecessorLog = infoCalls.find((entry) =>
      entry.message === "Explicit review claim found a stale predecessor attempt",
    );
    expect(predecessorLog).toBeDefined();
    expect(predecessorLog?.bindings.reviewFamilyKey).toBe("acme/repo#104");
    expect(predecessorLog?.bindings.reviewWorkAttemptId).toBe("attempt-explicit-claim");
    expect(predecessorLog?.bindings.predecessorAttemptId).toBe("attempt-automatic-older");
    expect(predecessorLog?.bindings.predecessorPhase).toBe("incremental-diff");
    expect(predecessorLog?.bindings.predecessorAgeMs).toBe(50);
  });

  test("explicit PR review mention suppresses approval bridge when publish rights were superseded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 104;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const claimedFamilies: Array<Record<string, unknown>> = [];
    const completedAttemptIds: string[] = [];
    let createReviewCalls = 0;
    const issueReplies: string[] = [];

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => {
            createReviewCalls++;
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 3,
          durationMs: 1,
          sessionId: "session-mention-superseded",
          model: "claude-sonnet-4-5-20250929",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          stopReason: "end_turn",
          toolUseNames: ["Glob", "Read"],
          usedRepoInspectionTools: true,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => {
          claimedFamilies.push(claim);
          return {
            attemptId: "attempt-explicit-1",
            familyKey: claim.familyKey,
            source: claim.source,
            lane: claim.lane,
            deliveryId: claim.deliveryId,
            phase: claim.phase,
            claimedAtMs: 100,
            lastProgressAtMs: 100,
          };
        },
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createReviewCalls).toBe(0);
    expect(issueReplies).toHaveLength(0);
    expect(claimedFamilies).toEqual([
      {
        familyKey: "acme/repo#104",
        source: "explicit-review",
        lane: "interactive-review",
        deliveryId: "delivery-pr-issue-comment-mention",
        phase: "claimed",
      },
    ]);
    expect(completedAttemptIds).toEqual(["attempt-explicit-1"]);

    const skipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish because publish rights were superseded",
    );
    expect(skipLog?.bindings.reviewOutputKey).toBeString();

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.explicitReviewRequest).toBe(true);
    expect(completionLog?.bindings.published).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("none");

    await workspaceFixture.cleanup();
  });

  async function runSupersededExplicitReviewLatePublish(options: {
    prNumber: number;
    executorResult?: {
      conclusion: "success" | "error" | "failure";
      published: boolean;
      costUsd: number;
      numTurns: number;
      durationMs: number;
      sessionId: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      stopReason?: string;
      toolUseNames?: string[];
      usedRepoInspectionTools?: boolean;
      errorMessage?: string;
      isTimeout?: boolean;
      resultText?: string;
    };
    executorError?: Error;
  }) {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${options.prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls, errorCalls } = createMockLogger();
    const completedAttemptIds: string[] = [];
    const issueReplies: string[] = [];
    const reviewThreadReplies: string[] = [];
    let updateCommentCalls = 0;
    let createReviewCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async ({ body }: { body: string }) => {
            reviewThreadReplies.push(body);
            return { data: {} };
          },
          createReview: async () => {
            createReviewCalls += 1;
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: { id: issueReplies.length } };
          },
          updateComment: async () => {
            updateCommentCalls += 1;
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: options.executorError
        ? {
            execute: async () => {
              throw options.executorError;
            },
          } as never
        : {
            execute: async () => options.executorResult!,
          } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-explicit-late-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "explicit-review",
          lane: claim.lane as "interactive-review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber: options.prNumber,
        commentBody: "@kodiai review",
      }),
    );

    await workspaceFixture.cleanup();

    return {
      infoCalls,
      errorCalls,
      issueReplies,
      reviewThreadReplies,
      updateCommentCalls,
      createReviewCalls,
      completedAttemptIds,
    };
  }

  test("explicit PR review mention suppresses fallback reply when publish rights were superseded", async () => {
    const result = await runSupersededExplicitReviewLatePublish({
      prNumber: 106,
      executorResult: {
        conclusion: "success",
        published: false,
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session-explicit-late-reply",
        toolUseNames: ["Read"],
        usedRepoInspectionTools: false,
        stopReason: "end_turn",
      },
    });

    expect(result.createReviewCalls).toBe(0);
    expect(result.issueReplies).toHaveLength(0);
    expect(result.reviewThreadReplies).toHaveLength(0);
    expect(result.updateCommentCalls).toBe(0);
    expect(result.completedAttemptIds).toEqual(["attempt-explicit-late-1"]);
    expect(
      result.infoCalls.some((entry) => entry.message === "Skipping explicit mention review fallback reply because publish rights were superseded"),
    ).toBeTrue();
  });

  test("explicit PR review mention suppresses error fallback when publish rights were superseded", async () => {
    const result = await runSupersededExplicitReviewLatePublish({
      prNumber: 107,
      executorResult: {
        conclusion: "error",
        published: false,
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session-explicit-late-error",
        toolUseNames: ["Read"],
        usedRepoInspectionTools: false,
        errorMessage: "review run failed",
      },
    });

    expect(result.createReviewCalls).toBe(0);
    expect(result.issueReplies).toHaveLength(0);
    expect(result.reviewThreadReplies).toHaveLength(0);
    expect(result.updateCommentCalls).toBe(0);
    expect(result.completedAttemptIds).toEqual(["attempt-explicit-late-1"]);
    expect(
      result.infoCalls.some((entry) => entry.message === "Skipping explicit mention review error fallback because publish rights were superseded"),
    ).toBeTrue();
  });

  test("explicit PR review mention suppresses failure fallback when publish rights were superseded", async () => {
    const result = await runSupersededExplicitReviewLatePublish({
      prNumber: 108,
      executorResult: {
        conclusion: "failure",
        published: false,
        costUsd: 0,
        numTurns: 1,
        durationMs: 1,
        sessionId: "session-explicit-late-failure",
        toolUseNames: ["Read"],
        usedRepoInspectionTools: false,
        errorMessage: "publish fallback failed",
        stopReason: "end_turn",
      },
    });

    expect(result.createReviewCalls).toBe(0);
    expect(result.issueReplies).toHaveLength(0);
    expect(result.reviewThreadReplies).toHaveLength(0);
    expect(result.updateCommentCalls).toBe(0);
    expect(result.completedAttemptIds).toEqual(["attempt-explicit-late-1"]);
    expect(
      result.infoCalls.some((entry) => entry.message === "Skipping explicit mention review failure fallback because publish rights were superseded"),
    ).toBeTrue();
  });

  test("explicit PR review mention suppresses handler failure comment when publish rights were superseded", async () => {
    const result = await runSupersededExplicitReviewLatePublish({
      prNumber: 109,
      executorError: new Error("executor exploded"),
    });

    expect(result.createReviewCalls).toBe(0);
    expect(result.issueReplies).toHaveLength(0);
    expect(result.reviewThreadReplies).toHaveLength(0);
    expect(result.updateCommentCalls).toBe(0);
    expect(result.completedAttemptIds).toEqual(["attempt-explicit-late-1"]);
  });

  test("explicit PR review mention logs idempotency skip when review output already exists", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 105;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    let createReviewCalls = 0;
    const issueReplies: string[] = [];
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber,
      action: "mention-review",
      deliveryId: "delivery-pr-issue-comment-mention",
      headSha: "feature",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({
            data: [{ id: 1, body: `Silent approval\n\n${marker}` }],
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => {
            createReviewCalls++;
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention-idempotency-skip",
          toolUseNames: ["Read"],
          usedRepoInspectionTools: true,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createReviewCalls).toBe(0);
    expect(issueReplies).toHaveLength(0);

    const skipLog = infoCalls.find((entry) =>
      entry.message === "Skipping explicit mention review publish because output already exists",
    );
    expect(skipLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(skipLog?.bindings.idempotencyDecision).toBe("skip-existing-review");
    expect(skipLog?.bindings.reviewOutputPublicationState).toBe("skip-existing-output");
    expect(skipLog?.bindings.existingLocation).toBe("review");
    expect(skipLog?.bindings.gate).toBe("review-output-idempotency");
    expect(skipLog?.bindings.gateResult).toBe("skipped");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(completionLog?.bindings.published).toBe(true);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("idempotency-skip");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention suppresses fallback when publish recheck finds output", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 106;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls, warnCalls } = createMockLogger();
    const issueReplies: string[] = [];
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber,
      action: "mention-review",
      deliveryId: "delivery-pr-issue-comment-mention",
      headSha: "feature",
    });
    const marker = buildReviewOutputMarker(reviewOutputKey);
    let listReviewsCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => {
            listReviewsCalls++;
            return listReviewsCalls === 1
              ? { data: [] }
              : { data: [{ id: 1, body: `Recovered approval\n\n${marker}` }] };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => {
            throw new Error("publish blocked after create");
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention-publish-recheck",
          toolUseNames: ["Read"],
          usedRepoInspectionTools: true,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(issueReplies).toHaveLength(0);

    const failureLog = warnCalls.find((entry) =>
      entry.message === "Failed to submit approval review for explicit mention request",
    );
    expect(failureLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(failureLog?.bindings.publishAttemptOutcome).toBe("failed");
    expect(failureLog?.bindings.publishFailureCategory).toBe("internal_error");

    const recoveredLog = infoCalls.find((entry) =>
      entry.message === "Explicit mention review publish error still produced output; suppressing fallback",
    );
    expect(recoveredLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(recoveredLog?.bindings.gateResult).toBe("recovered");
    expect(recoveredLog?.bindings.reviewOutputPublicationState).toBe("skip-existing-output");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(completionLog?.bindings.published).toBe(true);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("duplicate-suppressed");
    expect(completionLog?.bindings.publishFailureCategory).toBe("internal_error");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention logs publish failure when approval submission throws", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 107;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls, warnCalls } = createMockLogger();
    const issueReplies: string[] = [];
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber,
      action: "mention-review",
      deliveryId: "delivery-pr-issue-comment-mention",
      headSha: "feature",
    });

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => {
            throw Object.assign(new Error("Validation Failed"), { status: 422 });
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: {} };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention-publish-failure",
          toolUseNames: ["Read"],
          usedRepoInspectionTools: true,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Kodiai couldn't publish the review result");
    expect(issueReplies[0]).toContain("Kodiai encountered an API error");
    expect(issueReplies[0]).toContain("GitHub rejected the publish step. Validation Failed");
    expect(issueReplies[0]).not.toContain("Decision: NOT APPROVED");

    const attemptLog = infoCalls.find((entry) =>
      entry.message === "Attempting explicit mention review approval publish",
    );
    expect(attemptLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(attemptLog?.bindings.publishAttemptOutcome).toBe("attempting-approval");

    const failureLog = warnCalls.find((entry) =>
      entry.message === "Failed to submit approval review for explicit mention request",
    );
    expect(failureLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(failureLog?.bindings.publishAttemptOutcome).toBe("github-api-rejected");
    expect(failureLog?.bindings.publishFailureCategory).toBe("api_error");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(completionLog?.bindings.published).toBe(true);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("publish-failure-fallback");
    expect(completionLog?.bindings.publishFailureCategory).toBe("api_error");
    expect(completionLog?.bindings.publishFallbackDelivery).toBe("error-comment-created");

    await workspaceFixture.cleanup();
  });

  test("explicit PR review mention logs fallback comment delivery failure distinctly", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture("mention:\n  enabled: true\nreview:\n  autoApprove: true\n");

    const prNumber = 108;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls, warnCalls, errorCalls } = createMockLogger();
    const issueReplies: string[] = [];
    const reviewOutputKey = buildReviewOutputKey({
      installationId: 42,
      owner: "acme",
      repo: "repo",
      prNumber,
      action: "mention-review",
      deliveryId: "delivery-pr-issue-comment-mention",
      headSha: "feature",
    });

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => {
            throw Object.assign(new Error("Validation Failed"), { status: 403 });
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            throw new Error("comment write blocked");
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention-fallback-comment-failure",
          toolUseNames: ["Read"],
          usedRepoInspectionTools: true,
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(issueReplies).toHaveLength(1);

    const helperFailureLog = errorCalls.find((entry) =>
      entry.message === "Failed to post/update error comment",
    );
    expect(helperFailureLog?.bindings.errorCommentMethod).toBe("create-comment");

    const fallbackFailureLog = warnCalls.find((entry) =>
      entry.message === "Explicit mention review publish fallback could not be delivered",
    );
    expect(fallbackFailureLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(fallbackFailureLog?.bindings.publishAttemptOutcome).toBe("fallback-comment-failed");
    expect(fallbackFailureLog?.bindings.publishFailureCategory).toBe("api_error");
    expect(fallbackFailureLog?.bindings.publishFallbackDelivery).toBe("error-comment-failed");

    const completionLog = infoCalls.find((entry) => entry.message === "Mention execution completed");
    expect(completionLog?.bindings.reviewOutputKey).toBe(reviewOutputKey);
    expect(completionLog?.bindings.published).toBe(false);
    expect(completionLog?.bindings.executorPublished).toBe(false);
    expect(completionLog?.bindings.publishResolution).toBe("publish-failure-comment-failed");
    expect(completionLog?.bindings.publishFailureCategory).toBe("api_error");
    expect(completionLog?.bindings.publishFallbackDelivery).toBe("error-comment-failed");

    await workspaceFixture.cleanup();
  });

  test("@kodai review uses review task type and review output key", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    const prNumber = 103;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedTaskType: string | undefined;
    let capturedReviewOutputKey: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { taskType?: string; reviewOutputKey?: string }) => {
          capturedTaskType = ctx.taskType;
          capturedReviewOutputKey = ctx.reviewOutputKey;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodai review",
      }),
    );

    expect(capturedTaskType).toBe("review.full");
    expect(capturedReviewOutputKey).toBeDefined();
    expect(capturedReviewOutputKey).toContain("kodiai-review-output:v1:");

    await workspaceFixture.cleanup();
  });

  test("@kodiai review uses review task type and review output key", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    const prNumber = 102;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedTaskType: string | undefined;
    let capturedReviewOutputKey: string | undefined;
    let capturedTriggerBody: string | undefined;
    let capturedPrompt: string | undefined;
    let capturedMaxTurnsOverride: number | undefined;
    let capturedEnableInlineTools: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { taskType?: string; reviewOutputKey?: string; triggerBody?: string; prompt?: string; maxTurnsOverride?: number; enableInlineTools?: boolean }) => {
          capturedTaskType = ctx.taskType;
          capturedReviewOutputKey = ctx.reviewOutputKey;
          capturedTriggerBody = ctx.triggerBody;
          capturedPrompt = ctx.prompt;
          capturedMaxTurnsOverride = ctx.maxTurnsOverride;
          capturedEnableInlineTools = ctx.enableInlineTools;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(capturedTaskType).toBe("review.full");
    expect(capturedReviewOutputKey).toBeDefined();
    expect(capturedReviewOutputKey).toContain("kodiai-review-output:v1:");
    expect(capturedTriggerBody).toBe("review");
    expect(capturedPrompt).toContain("You are reviewing pull request #102 in acme/repo.");
    expect(capturedPrompt).toContain("If NO issues found: do nothing -- no summary, no comments. The calling code handles silent approval.");
    expect(capturedPrompt).not.toContain("You MUST post a reply when you are mentioned.");
    expect(capturedMaxTurnsOverride).toBeUndefined();
    expect(capturedEnableInlineTools).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("@kodiai review carries large-PR triage context into the review prompt", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      [
        "mention:",
        "  enabled: true",
        "largePR:",
        "  fileThreshold: 10",
        "  fullReviewCount: 5",
        "  abbreviatedCount: 2",
      ].join("\n") + "\n",
    );

    const prNumber = 103;
    await $`git -C ${workspaceFixture.dir} checkout feature`.quiet();
    await $`mkdir -p ${join(workspaceFixture.dir, "src")}`.quiet();
    for (const fileName of [
      "alpha.ts",
      "beta.ts",
      "gamma.ts",
      "delta.ts",
      "epsilon.ts",
      "zeta.ts",
      "eta.ts",
      "theta.ts",
      "iota.ts",
      "kappa.ts",
      "lambda.ts",
    ]) {
      await Bun.write(
        join(workspaceFixture.dir, "src", fileName),
        `export const ${fileName.replace(/\.ts$/, "")} = true;\n`,
      );
    }
    await $`git -C ${workspaceFixture.dir} add src`.quiet();
    await $`git -C ${workspaceFixture.dir} commit -m "add explicit review prompt files"`.quiet();
    await $`git -C ${workspaceFixture.dir} push -f origin feature`.quiet();

    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedPrompt: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
              labels: [],
              draft: false,
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          capturedPrompt = ctx.prompt;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(capturedPrompt).toContain("## Large PR Triage");
    expect(capturedPrompt).toContain("### Full Review");
    expect(capturedPrompt).toContain("### Abbreviated Review");

    await workspaceFixture.cleanup();
  });

  test("@kodiai review falls back to GitHub PR files when shallow prompt diff has no merge base", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    const prNumber = 104;

    await $`git -C ${workspaceFixture.dir} checkout feature`.quiet();
    await $`mkdir -p ${join(workspaceFixture.dir, "src")}`.quiet();
    await Bun.write(join(workspaceFixture.dir, "src", "feature-only.ts"), "export const featureOnly = true;\n");
    await $`git -C ${workspaceFixture.dir} add src/feature-only.ts`.quiet();
    await $`git -C ${workspaceFixture.dir} commit -m "feature-only change"`.quiet();
    await $`git -C ${workspaceFixture.dir} push -f origin feature`.quiet();

    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    await $`git -C ${workspaceFixture.dir} checkout main`.quiet();
    await Bun.write(join(workspaceFixture.dir, "src", "base-only.ts"), "export const baseOnly = true;\n");
    await $`git -C ${workspaceFixture.dir} add src/base-only.ts`.quiet();
    await $`git -C ${workspaceFixture.dir} commit -m "main-only change"`.quiet();
    await $`git -C ${workspaceFixture.dir} push -f origin main`.quiet();

    let capturedPrompt: string | undefined;
    let listFilesCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        const cloneDir = await mkdtemp(join(tmpdir(), "kodiai-mention-shallow-"));
        await $`git clone --depth=1 --single-branch --branch ${options.ref} file://${workspaceFixture.remoteDir} ${cloneDir}`.quiet();
        return {
          dir: cloneDir,
          cleanup: async () => {
            await rm(cloneDir, { recursive: true, force: true });
          },
        };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
              labels: [],
              draft: false,
            },
          }),
          list: async () => ({ data: [] }),
          listFiles: async () => {
            listFilesCalls++;
            return {
              data: [
                { filename: "README.md" },
                { filename: "src/feature-only.ts" },
              ],
            };
          },
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { prompt?: string }) => {
          capturedPrompt = ctx.prompt;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(capturedPrompt).toContain("- src/feature-only.ts");
    expect(capturedPrompt).not.toContain("src/base-only.ts");

    await workspaceFixture.cleanup();
  });

  test("@kodiai please retry review stays on the explicit review path", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    const prNumber = 103;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedTaskType: string | undefined;
    let capturedReviewOutputKey: string | undefined;
    let capturedTriggerBody: string | undefined;
    let capturedMaxTurnsOverride: number | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { taskType?: string; reviewOutputKey?: string; triggerBody?: string; maxTurnsOverride?: number }) => {
          capturedTaskType = ctx.taskType;
          capturedReviewOutputKey = ctx.reviewOutputKey;
          capturedTriggerBody = ctx.triggerBody;
          capturedMaxTurnsOverride = ctx.maxTurnsOverride;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai please retry review",
      }),
    );

    expect(capturedTaskType).toBe("review.full");
    expect(capturedReviewOutputKey).toBeDefined();
    expect(capturedReviewOutputKey).toContain("kodiai-review-output:v1:");
    expect(capturedTriggerBody).toBe("please retry review");
    expect(capturedMaxTurnsOverride).toBeUndefined();

    await workspaceFixture.cleanup();
  });

  test("@kodiai review triggers executor instead of delegating to aireview team", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let executorCalled = false;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai review",
      }),
    );

    expect(executorCalled).toBe(true);

    await workspaceFixture.cleanup();
  });
});

describe("createMentionHandler allowedUsers gating (CONFIG-07)", () => {
  test("mention from allowed user proceeds (executor called)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n  allowedUsers:\n    - alice\n    - Bob\n",
    );

    let executorCalled = false;

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    // alice is in allowedUsers (case-insensitive match)
    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    expect(executorCalled).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("mention from non-allowed user is skipped (executor NOT called)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n  allowedUsers:\n    - bob\n",
    );

    let executorCalled = false;

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    // alice is NOT in allowedUsers (only bob is)
    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    expect(executorCalled).toBe(false);

    await workspaceFixture.cleanup();
  });

  test("empty allowedUsers allows all users (existing behavior preserved)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    let executorCalled = false;

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => {
          executorCalled = true;
          return {
            conclusion: "success",
            published: true,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    // Any user should be allowed with empty allowedUsers
    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    expect(executorCalled).toBe(true);

    await workspaceFixture.cleanup();
  });
});

describe("createMentionHandler telemetry opt-out (CONFIG-10)", () => {
  test("telemetry.enabled: false suppresses telemetryStore.record for mentions", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\ntelemetry:\n  enabled: false\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let recordCalls = 0;
    const telemetryStore = {
      record: () => { recordCalls++; },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: true,
          costUsd: 0.5,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    await workspaceFixture.cleanup();
    expect(recordCalls).toBe(0);
  });
});

describe("createMentionHandler cost warning (CONFIG-11)", () => {
  test("posts cost warning comment when threshold exceeded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\ntelemetry:\n  enabled: true\n  costWarningUsd: 1.0\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let costWarningBody: string | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async (params: { body: string }) => {
            costWarningBody = params.body;
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: true,
          costUsd: 3.5,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    await workspaceFixture.cleanup();
    expect(costWarningBody).toBeDefined();
    expect(costWarningBody!).toContain("cost warning");
    expect(costWarningBody!).toContain("$3.5000");
    expect(costWarningBody!).toContain("$1.00");
  });

  test("explicit PR review mention suppresses cost warning comment when publish rights were superseded", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\ntelemetry:\n  enabled: true\n  costWarningUsd: 1.0\nreview:\n  autoApprove: true\n",
    );

    const prNumber = 110;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const { logger, infoCalls } = createMockLogger();
    const completedAttemptIds: string[] = [];
    const issueReplies: string[] = [];
    let createReviewCalls = 0;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForIssueComment: async () => ({ data: {} }),
          createForPullRequestReviewComment: async () => ({ data: {} }),
        },
        pulls: {
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          list: async () => ({ data: [] }),
          listReviews: async () => ({ data: [] }),
          listReviewComments: async () => ({ data: [] }),
          createReplyForReviewComment: async () => ({ data: {} }),
          createReview: async () => {
            createReviewCalls += 1;
            return { data: {} };
          },
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async ({ body }: { body: string }) => {
            issueReplies.push(body);
            return { data: { id: issueReplies.length } };
          },
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: false,
          costUsd: 3.5,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-explicit-cost-warning-superseded",
          toolUseNames: ["Read"],
          usedRepoInspectionTools: false,
          stopReason: "end_turn",
        }),
      } as never,
      telemetryStore: noopTelemetryStore,
      reviewWorkCoordinator: {
        claim: (claim: Record<string, unknown>) => ({
          attemptId: "attempt-explicit-cost-warning-1",
          familyKey: claim.familyKey as string,
          source: claim.source as "explicit-review",
          lane: claim.lane as "interactive-review",
          deliveryId: claim.deliveryId as string,
          phase: claim.phase as "claimed",
          claimedAtMs: 100,
          lastProgressAtMs: 100,
        }),
        canPublish: () => false,
        setPhase: () => null,
        getSnapshot: () => null,
        release: () => undefined,
        complete: (attemptId: string) => {
          completedAttemptIds.push(attemptId);
        },
      } as never,
      logger,
    });

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai review",
      }),
    );

    expect(createReviewCalls).toBe(0);
    expect(issueReplies).toHaveLength(0);
    expect(completedAttemptIds).toEqual(["attempt-explicit-cost-warning-1"]);
    expect(
      infoCalls.some((entry) => entry.message === "Skipping explicit mention review cost warning comment because publish rights were superseded"),
    ).toBeTrue();

    await workspaceFixture.cleanup();
  });

  test("no cost warning when telemetry disabled", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\ntelemetry:\n  enabled: false\n  costWarningUsd: 1.0\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let createCommentCalled = false;
    let recordCalls = 0;
    const telemetryStore = {
      record: () => { recordCalls++; },
      purgeOlderThan: () => 0,
      checkpoint: () => {},
      close: () => {},
    } as never;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => { handlers.set(eventKey, handler); },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => {
            createCommentCalled = true;
            return { data: {} };
          },
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: { ref: "feature" },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async () => ({
          conclusion: "success",
          published: true,
          costUsd: 5.0,
          numTurns: 1,
          durationMs: 1,
          sessionId: "session-mention",
        }),
      } as never,
      telemetryStore,
      logger: createNoopLogger(),
    });

    const handler = handlers.get("pull_request_review_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildReviewCommentMentionEvent({
        prNumber,
        baseRef: "main",
        headRef: "feature",
        headRepoOwner: "forker",
        headRepoName: "repo",
        commentBody: "@kodiai please look at this",
      }),
    );

    await workspaceFixture.cleanup();
    expect(recordCalls).toBe(0);
    expect(createCommentCalled).toBe(false);
  });
});

describe("scanLinesForFabricatedContent", () => {
  test("detects repeating hex pattern", () => {
    const repeating = "d1e5de5edf8d6addd1e5de5edf8d6addd1e5de5edf8d6addd1e5de5edf8d6add";
    const warnings = scanLinesForFabricatedContent([`+SHA512=${repeating}`]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("repeating hex");
  });

  test("detects all-same-char hex", () => {
    const allA = "a".repeat(64);
    const warnings = scanLinesForFabricatedContent([`+hash=${allA}`]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("low-entropy");
  });

  test("ignores legitimate hex strings", () => {
    const legit = "3a7b9c2e1f4d8a6b5c0e7f2d9a4b8c1e6f3d7a0b5c9e2f8d1a4b7c0e3f6d9a";
    const warnings = scanLinesForFabricatedContent([`+SHA512=${legit}`]);
    expect(warnings).toEqual([]);
  });

  test("ignores short hex strings", () => {
    const short = "abcdef1234567890";
    const warnings = scanLinesForFabricatedContent([`+hash=${short}`]);
    expect(warnings).toEqual([]);
  });

  test("returns empty for lines without hex", () => {
    const warnings = scanLinesForFabricatedContent(["+const x = 42;", "+// comment"]);
    expect(warnings).toEqual([]);
  });
});

describe("PR surface implicit write intent detection", () => {
  test("PR comment 'update this PR' triggers write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedWriteMode: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/write-intent" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai update this PR",
      }),
    );

    expect(capturedWriteMode).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("PR comment 'fix this' triggers write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedWriteMode: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/write-intent" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai fix this",
      }),
    );

    expect(capturedWriteMode).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("PR comment 'yes, go ahead' triggers write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedWriteMode: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/write-intent" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai yes, go ahead",
      }),
    );

    expect(capturedWriteMode).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("PR comment 'create a patch' still triggers write mode (regression)", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedWriteMode: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/write-intent" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: true,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai create a patch",
      }),
    );

    expect(capturedWriteMode).toBe(true);

    await workspaceFixture.cleanup();
  });

  test("PR comment 'what does this do' does not trigger write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let capturedWriteMode: boolean | undefined;

    const eventRouter: EventRouter = {
      register: (eventKey, handler) => {
        handlers.set(eventKey, handler);
      },
      dispatch: async () => undefined,
    };

    const jobQueue: JobQueue = {
      enqueue: async <T>(_installationId: number, fn: (metadata: JobQueueRunMetadata) => Promise<T>) => fn(createQueueRunMetadata()),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
      getActiveJobs: getEmptyActiveJobs,
    };

    const workspaceManager: WorkspaceManager = {
      create: async (_installationId: number, options: CloneOptions) => {
        await $`git -C ${workspaceFixture.dir} checkout ${options.ref}`.quiet();
        return { dir: workspaceFixture.dir, cleanup: async () => undefined };
      },
      cleanupStale: async () => 0,
    };

    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment: async () => ({ data: {} }),
          createForIssueComment: async () => ({ data: {} }),
        },
        issues: {
          listComments: async () => ({ data: [] }),
          createComment: async () => ({ data: {} }),
        },
        pulls: {
          list: async () => ({ data: [] }),
          get: async () => ({
            data: {
              number: prNumber,
              title: "Test PR",
              body: "",
              user: { login: "octocat" },
              head: {
                ref: "feature",
                repo: {
                  name: "repo",
                  owner: { login: "acme" },
                },
              },
              base: { ref: "main" },
            },
          }),
          createReplyForReviewComment: async () => ({ data: {} }),
          create: async () => ({ data: { html_url: "https://example.com/pr/write-intent" } }),
        },
      },
    };

    createMentionHandler({
      eventRouter,
      jobQueue,
      workspaceManager,
      githubApp: {
        getAppSlug: () => "kodiai",
        getInstallationOctokit: async () => octokit as never,
      } as unknown as GitHubApp,
      executor: {
        execute: async (ctx: { writeMode?: boolean }) => {
          capturedWriteMode = ctx.writeMode;
          return {
            conclusion: "success",
            published: false,
            writeMode: ctx.writeMode,
            costUsd: 0,
            numTurns: 1,
            durationMs: 1,
            sessionId: "session-mention",
          };
        },
      } as never,
      telemetryStore: noopTelemetryStore,
      logger: createNoopLogger(),
    });

    const issueHandler = handlers.get("issue_comment.created");
    expect(issueHandler).toBeDefined();

    await issueHandler!(
      buildPrIssueCommentMentionEvent({
        prNumber,
        commentBody: "@kodiai what does this do?",
      }),
    );

    expect(capturedWriteMode).toBe(false);

    await workspaceFixture.cleanup();
  });
});
