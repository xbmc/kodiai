import { describe, it, expect, beforeEach } from "bun:test";
import { createIssueOpenedHandler } from "./issue-opened.ts";
import type { EventRouter, WebhookEvent, EventHandler } from "../webhook/types.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider, EmbeddingResult } from "../knowledge/types.ts";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import type { JobQueue } from "../jobs/types.ts";
import type { WorkspaceManager } from "../jobs/types.ts";
import type { RepoConfig } from "../execution/config.ts";

// ── Test helpers ──────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    warn: () => {},
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => createMockLogger(),
  } as unknown as Logger;
}

type CapturedHandler = { key: string; handler: EventHandler };

function createMockEventRouter(): EventRouter & { captured: CapturedHandler[] } {
  const captured: CapturedHandler[] = [];
  return {
    captured,
    register(eventKey: string, handler: EventHandler) {
      captured.push({ key: eventKey, handler });
    },
    dispatch: async () => {},
  };
}

function createMockJobQueue(): JobQueue {
  return {
    enqueue: async <T>(_installationId: number, fn: () => Promise<T>) => fn(),
    getQueueSize: () => 0,
    getPendingCount: () => 0,
  };
}

function createMockOctokit(opts?: {
  comments?: Array<{ body?: string | null }>;
  addLabelsError?: Error;
}) {
  return {
    rest: {
      issues: {
        listComments: async () => ({
          data: opts?.comments ?? [],
        }),
        createComment: async () => ({ data: { id: 1 } }),
        addLabels: async () => {
          if (opts?.addLabelsError) throw opts.addLabelsError;
          return { data: [] };
        },
      },
    },
  };
}

function createMockGithubApp(octokitOpts?: Parameters<typeof createMockOctokit>[0]): GitHubApp {
  return {
    getInstallationOctokit: async () => createMockOctokit(octokitOpts) as any,
    getAppSlug: () => "kodiai",
    initialize: async () => {},
    checkConnectivity: async () => true,
  } as unknown as GitHubApp;
}

function createMockIssueStore(results: any[] = []): IssueStore {
  return {
    searchByEmbedding: async () => results,
  } as unknown as IssueStore;
}

function createMockEmbeddingProvider(
  result: EmbeddingResult = {
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    model: "voyage-code-3",
    dimensions: 3,
  },
): EmbeddingProvider {
  return {
    generate: async () => result,
    model: "voyage-code-3",
    dimensions: 3,
  };
}

function createMockSql(claimSuccess: boolean = true): Sql {
  const fn = async (..._args: any[]) => {
    return claimSuccess ? [{ id: 1 }] : [];
  };
  // postgres.js tagged template literal interface
  return new Proxy(fn, {
    apply: (_target, _thisArg, args) => fn(...args),
  }) as unknown as Sql;
}

function createMockWorkspaceManager(config?: Partial<RepoConfig>): WorkspaceManager {
  // Write a temporary .kodiai.yml to the workspace dir
  return {
    create: async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const dir = await mkdtemp(path.join(tmpdir(), "issue-opened-test-"));

      // Write the config file
      const yaml = await import("js-yaml");
      const configObj = {
        triage: {
          enabled: config?.triage?.enabled ?? false,
          autoTriageOnOpen: config?.triage?.autoTriageOnOpen ?? false,
          duplicateThreshold: config?.triage?.duplicateThreshold ?? 75,
          maxDuplicateCandidates: config?.triage?.maxDuplicateCandidates ?? 3,
          duplicateLabel: config?.triage?.duplicateLabel ?? "possible-duplicate",
          cooldownMinutes: 30,
        },
      };
      await writeFile(
        path.join(dir, ".kodiai.yml"),
        yaml.dump(configObj),
        "utf-8",
      );

      return {
        dir,
        cleanup: async () => {
          const { rm } = await import("node:fs/promises");
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        },
      };
    },
    cleanupStale: async () => 0,
  };
}

function makeEvent(overrides?: Partial<WebhookEvent["payload"]>): WebhookEvent {
  return {
    id: "delivery-123",
    name: "issues",
    installationId: 1,
    payload: {
      action: "opened",
      issue: {
        number: 100,
        title: "App crashes on login",
        body: "When I try to login, the app crashes.",
        user: { login: "testuser" },
      },
      repository: {
        full_name: "owner/repo",
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
      },
      ...overrides,
    },
  };
}

function makeSearchResult(
  issueNumber: number,
  title: string,
  state: string,
  distance: number,
) {
  return {
    record: {
      id: issueNumber,
      createdAt: "2026-01-01",
      repo: "owner/repo",
      owner: "owner",
      issueNumber,
      title,
      body: null,
      state,
      authorLogin: "user",
      authorAssociation: null,
      labelNames: [],
      templateSlug: null,
      commentCount: 0,
      assignees: [],
      milestone: null,
      reactionCount: 0,
      isPullRequest: false,
      locked: false,
      embedding: null,
      embeddingModel: null,
      githubCreatedAt: "2026-01-01",
      githubUpdatedAt: null,
      closedAt: null,
    },
    distance,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createIssueOpenedHandler", () => {
  let router: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    router = createMockEventRouter();
  });

  it("registers on issues.opened event", () => {
    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp: createMockGithubApp(),
      workspaceManager: createMockWorkspaceManager(),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      logger: createMockLogger(),
    });

    expect(router.captured).toHaveLength(1);
    expect(router.captured[0].key).toBe("issues.opened");
  });

  it("returns early when triage is disabled", async () => {
    let commentPosted = false;
    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: false, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(false);
  });

  it("returns early when autoTriageOnOpen is false", async () => {
    let commentPosted = false;
    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: false } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(false);
  });

  it("returns early when DB claim fails (already triaged)", async () => {
    let commentPosted = false;
    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(false), // claim fails
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(false);
  });

  it("does not post comment when no duplicates found", async () => {
    let commentPosted = false;
    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore([]), // no results
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(true),
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(false);
  });

  it("posts comment and applies label when duplicates found", async () => {
    let commentPosted = false;
    let commentBody = "";
    let labelApplied = false;
    let appliedLabels: string[] = [];

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async (params: { body: string }) => {
              commentPosted = true;
              commentBody = params.body;
              return { data: { id: 1 } };
            },
            addLabels: async (params: { labels: string[] }) => {
              labelApplied = true;
              appliedLabels = params.labels;
              return { data: [] };
            },
          },
        },
      }),
    } as unknown as GitHubApp;

    const searchResults = [
      makeSearchResult(50, "Similar crash issue", "open", 0.1),  // 90% similarity
      makeSearchResult(51, "Another crash", "closed", 0.15),     // 85% similarity
    ];

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(true),
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(true);
    expect(commentBody).toContain("Possible duplicates detected:");
    expect(commentBody).toContain("#50");
    expect(commentBody).toContain("#51");
    expect(commentBody).toContain("kodiai:triage");
    expect(labelApplied).toBe(true);
    expect(appliedLabels).toEqual(["possible-duplicate"]);
  });

  it("continues when label API fails (fail-open)", async () => {
    let commentPosted = false;

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1 } };
            },
            addLabels: async () => {
              throw new Error("Label not found (422)");
            },
          },
        },
      }),
    } as unknown as GitHubApp;

    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(true),
      logger: createMockLogger(),
    });

    // Should not throw despite label API failure
    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(true);
  });

  it("returns early when triage marker found in existing comments", async () => {
    let commentPosted = false;
    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({
              data: [
                { body: "Some other comment" },
                { body: "Possible duplicates detected:\n<!-- kodiai:triage:owner/repo:100 -->" },
              ],
            }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(true),
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    expect(commentPosted).toBe(false);
  });

  it("continues to DB claim when comment scan fails (fail-open)", async () => {
    let commentPosted = false;
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];

    const githubApp = {
      getInstallationOctokit: async () => {
        let firstCall = true;
        return {
          rest: {
            issues: {
              listComments: async () => {
                if (firstCall) {
                  firstCall = false;
                  throw new Error("API rate limit exceeded");
                }
                return { data: [] };
              },
              createComment: async () => {
                commentPosted = true;
                return { data: { id: 1 } };
              },
              addLabels: async () => ({ data: [] }),
            },
          },
        };
      },
    } as unknown as GitHubApp;

    createIssueOpenedHandler({
      eventRouter: router,
      jobQueue: createMockJobQueue(),
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(true),
      logger: createMockLogger(),
    });

    await router.captured[0].handler(makeEvent());
    // Should continue despite comment scan failure and post comment
    expect(commentPosted).toBe(true);
  });
});
