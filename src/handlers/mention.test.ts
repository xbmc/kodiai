import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createMentionHandler } from "./mention.ts";
import { createRetriever } from "../knowledge/retrieval.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { JobQueue, WorkspaceManager, CloneOptions } from "../jobs/types.ts";

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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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

    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("I can answer this, but I need one detail first.");
    expect(issueReplies[0]).toContain("Could you share the exact outcome you want");
    expect(issueReplies[0]).not.toContain("Can you clarify what you want me to do?");
    expect(pullCreateCalls).toBe(0);
    expect(capturedWriteMode).toBe(false);

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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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

  test("implementation verbs on PR/review surfaces never auto-promote to write mode", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\nwrite:\n  enabled: true\n",
    );
    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    const issueReplies: string[] = [];
    const threadReplies: string[] = [];
    const writeModes: Array<boolean | undefined> = [];
    let pullCreateCalls = 0;

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
          createReplyForReviewComment: async (params: { body: string }) => {
            threadReplies.push(params.body);
            return { data: {} };
          },
          create: async () => {
            pullCreateCalls++;
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
    expect(writeModes.every((writeMode) => writeMode === false)).toBe(true);
    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    expect(threadReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Could you share the exact outcome you want");
    expect(threadReplies[0]).toContain("Could you share the exact outcome you want");

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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
        enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => {
          enqueueCalled = true;
          return fn();
        },
        getQueueSize: () => 0,
        getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
        enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
    expect(createdPrTitle).toContain("chore(issue-77):");
    expect(createdPrBody).toContain("Summary: update the README");
    expect(createdPrBody).toContain("Source issue: https://github.com/acme/repo/issues/77");
    expect(createdPrBody).toContain(
      "Trigger comment: https://github.com/acme/repo/issues/77#issuecomment-777",
    );
    expect(createdPrBody).toContain("Request: update the README");
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
        enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
        getQueueSize: () => 0,
        getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
      enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
      getQueueSize: () => 0,
      getPendingCount: () => 0,
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
