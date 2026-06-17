import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "pino";
import { createMentionHandler } from "./mention.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { CloneOptions, JobQueue, JobQueueRunMetadata, WorkspaceManager } from "../jobs/types.ts";
import { createQueueRunMetadata, getEmptyActiveJobs } from "../jobs/queue.test-helpers.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

const noopTelemetryStore = {
  record: async () => {},
  recordRetrievalQuality: async () => {},
  recordRateLimitEvent: async () => {},
  recordLlmCost: async () => {},
  recordPromptSections: async () => {},
  purgeOlderThan: async () => 0,
  checkpoint: () => {},
  close: () => {},
};

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

async function createWorkspaceFixture(configYml: string) {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-mention-config-trust-"));
  const remoteDir = await mkdtemp(join(tmpdir(), "kodiai-mention-config-trust-remote-"));

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
    id: "delivery-mention-config-trust",
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

describe("createMentionHandler PR config trust boundary", () => {
  test("PR mention allowedUsers policy comes from trusted base config, not PR head config", async () => {
    const handlers = new Map<string, (event: WebhookEvent) => Promise<void>>();
    const workspaceFixture = await createWorkspaceFixture(
      "mention:\n  enabled: true\n  allowedUsers:\n    - alice\n",
    );

    try {
      await $`git -C ${workspaceFixture.dir} checkout feature`.quiet();
      await Bun.write(
        join(workspaceFixture.dir, ".kodiai.yml"),
        "mention:\n  enabled: true\n  allowedUsers:\n    - bob\n",
      );
      await $`git -C ${workspaceFixture.dir} add .kodiai.yml`.quiet();
      await $`git -C ${workspaceFixture.dir} commit -m "untrusted head config"`.quiet();
      await $`git -C ${workspaceFixture.dir} push origin feature`.quiet();

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

      let executorCalled = false;
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
          commentBody: "@kodiai please look at this",
        }),
      );

      expect(executorCalled).toBe(true);
    } finally {
      await workspaceFixture.cleanup();
    }
  });
});
