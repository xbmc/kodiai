import { describe, it, expect, beforeEach } from "bun:test";
import { createIssueOpenedHandler } from "./issue-opened.ts";
import type { GitHubApp } from "../auth/github-app.ts";
import {
  createIssueTriageStateStoreHarness,
  createMockEmbeddingProvider,
  createMockEventRouter,
  createMockGithubApp,
  createMockIssueStore,
  createMockLogger,
  createMockSql,
  createMockWorkspaceManager,
  makeEvent,
  makeSearchResult,
} from "./issue-opened.test-helpers.ts";

describe("createIssueOpenedHandler", () => {
  let router: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    router = createMockEventRouter();
  });

  it("registers on issues.opened event", () => {
    createIssueOpenedHandler({
      eventRouter: router,
      githubApp: createMockGithubApp(),
      workspaceManager: createMockWorkspaceManager(),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    expect(router.captured).toHaveLength(1);
    expect(router.captured[0]!.key).toBe("issues.opened");
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: false, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: false } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore([]), // no results
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    // Should not throw despite label API failure
    await router.captured[0]!.handler(makeEvent());
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
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
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
    // Should continue despite comment scan failure and post comment
    expect(commentPosted).toBe(true);
  });

  it("stores comment GitHub ID after posting triage comment", async () => {
    const COMMENT_ID = 99887766;
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => ({ data: { id: COMMENT_ID } }),
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    const triageStateStore = createIssueTriageStateStoreHarness();

    createIssueOpenedHandler({
      eventRouter: router,
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: triageStateStore,
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());

    const commentIdCall = triageStateStore.callsByKind("storeCommentId")[0];
    expect(commentIdCall).toBeDefined();
    expect(commentIdCall!.input.commentGithubId).toBe(COMMENT_ID);
    expect(commentIdCall!.deliveryId).toBe("delivery-1");
  });

  it("uses learned threshold when available", async () => {
    let commentPosted = false;
    const searchResults = [
      makeSearchResult(50, "Similar crash issue", "open", 0.1), // 90% similarity
    ];

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

    const thresholdSql = createMockSql({
      thresholdRows: [{ alpha: 18, beta_: 4, sample_count: 25 }],
    });

    createIssueOpenedHandler({
      eventRouter: router,
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: thresholdSql,
      issueTriageStateStore: createIssueTriageStateStoreHarness(),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());

    // Comment should be posted (duplicates found with learned threshold)
    expect(commentPosted).toBe(true);
  });

  it("falls back to config threshold when getEffectiveThreshold query returns no rows", async () => {
    let commentPosted = false;
    const searchResults = [
      makeSearchResult(50, "Similar crash issue", "open", 0.1), // 90% similarity
    ];

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

    const triageStateStore = createIssueTriageStateStoreHarness();

    createIssueOpenedHandler({
      eventRouter: router,
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: triageStateStore,
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());

    // Comment should still be posted (config fallback threshold used, duplicates above it)
    expect(commentPosted).toBe(true);
  });

  it("continues when comment GitHub ID storage fails (fail-open)", async () => {
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];

    let labelApplied = false;
    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => ({ data: { id: 99887766 } }),
            addLabels: async () => {
              labelApplied = true;
              return { data: [] };
            },
          },
        },
      }),
    } as unknown as GitHubApp;

    const triageStateStore = createIssueTriageStateStoreHarness({ failCommentIdStore: true });

    createIssueOpenedHandler({
      eventRouter: router,
      githubApp,
      workspaceManager: createMockWorkspaceManager({
        triage: { enabled: true, autoTriageOnOpen: true } as any,
      }),
      issueStore: createMockIssueStore(searchResults),
      embeddingProvider: createMockEmbeddingProvider(),
      sql: createMockSql(),
      issueTriageStateStore: triageStateStore,
      logger: createMockLogger(),
    });

    // Should not throw -- handler continues to apply labels
    await router.captured[0]!.handler(makeEvent());
    expect(labelApplied).toBe(true);
  });
});
