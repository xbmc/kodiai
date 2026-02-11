import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createMentionHandler } from "./mention.ts";
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

const noopTelemetryStore = { record: () => {}, purgeOlderThan: () => 0, checkpoint: () => {}, close: () => {} } as never;

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
        id: 555,
        body: params.commentBody,
        user: { login: "alice" },
        created_at: "2025-01-15T12:00:00Z",
        diff_hunk: "@@ -1,1 +1,1\n- old\n+ new",
        path: "README.md",
        line: 1,
      },
    },
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

describe("createMentionHandler write intent gating", () => {
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

describe("createMentionHandler rereview command", () => {
  test("@kodiai review requests aireview team without posting a reply comment", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n",
    );

    const prNumber = 101;
    const featureSha = (await $`git -C ${workspaceFixture.dir} rev-parse feature`.quiet())
      .text()
      .trim();
    await $`git --git-dir ${workspaceFixture.remoteDir} update-ref refs/pull/${prNumber}/head ${featureSha}`.quiet();

    let requestedTeams: string[] | undefined;

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
          listRequestedReviewers: async () => ({ data: { users: [], teams: [] } }),
          requestReviewers: async (params: { team_reviewers: string[] }) => {
            requestedTeams = params.team_reviewers;
            return { data: {} };
          },
          createReplyForReviewComment: async () => {
            throw new Error("should not comment for rereview command");
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
        execute: async () => {
          throw new Error("should not execute for rereview command");
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

    expect(requestedTeams).toEqual(["aireview"]);

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
