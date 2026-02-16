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
    expect(issueReplies[0]).toContain("What exact outcome do you want from this change");
    expect(issueReplies[0]).toContain("Which files, directories, or modules should I focus on first?");
    expect(issueReplies[0]).toContain("Are there constraints I should respect");
    expect(issueReplies[0]).not.toContain("Can you clarify what you want me to do?");

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
  test("issue trigger A wording without apply/change returns deterministic opt-in commands", async () => {
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
    expect(issueReplies[0]).toContain("Issue comments are read-only by default.");
    expect(issueReplies[0]).toContain(
      "@kodiai apply: can you fix the issue intent gating copy so it is clearer for users?",
    );
    expect(issueReplies[0]).toContain(
      "@kodiai change: can you fix the issue intent gating copy so it is clearer for users?",
    );

    await workspaceFixture.cleanup();
  });

  test("quoted and prefixed issue rewrite ask is normalized and gated", async () => {
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
    expect(issueReplies[0]).toContain("Issue comments are read-only by default.");
    expect(issueReplies[0]).toContain(
      "@kodiai apply: can you improve the issue intent gating copy so it is clearer for users?",
    );
    expect(issueReplies[0]).toContain(
      "@kodiai change: can you improve the issue intent gating copy so it is clearer for users?",
    );

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
    expect(createdPrTitle).toContain("issue #77");
    expect(createdPrBody).toContain("Source issue: #77");
    expect(createdPrBody).toContain("Request: update the README");
    expect(createdPrBody).toContain("Delivery: delivery-issue-mention-123");
    expect(issueReplies).toHaveLength(1);
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
    expect(issueReplies[0]).toContain("Opened PR: https://example.com/pr/live-shape");
    expect(issueReplies[0]).not.toContain("I can only apply changes in a PR context.");

    await workspaceFixture.cleanup();
  });

  test("production-shape issue_comment without apply/change stays read-only guidance", async () => {
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

    const handler = handlers.get("issue_comment.created");
    expect(handler).toBeDefined();

    await handler!(
      buildLiveIssueCommentMentionEvent({
        commentBody: "@kodiai can you update the README wording for clarity?",
      }),
    );

    expect(executorCalled).toBe(false);
    expect(pullCreateCalls).toBe(0);
    expect(issueReplies).toHaveLength(1);
    expect(issueReplies[0]).toContain("Issue comments are read-only by default.");
    expect(issueReplies[0]).toContain(
      "@kodiai apply: can you update the README wording for clarity?",
    );
    expect(issueReplies[0]).toContain(
      "@kodiai change: can you update the README wording for clarity?",
    );

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
