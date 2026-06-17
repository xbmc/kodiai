import { beforeEach, describe, expect, it } from "bun:test";
import type { GitHubApp } from "../auth/github-app.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import { createIssueOpenedHandler } from "./issue-opened.ts";
import {
  createIssueTriageStateStoreHarness,
  createMockEmbeddingProvider,
  createMockEventRouter,
  createMockIssueStore,
  createMockLogger,
  createMockSql,
  createMockWorkspaceManager,
  makeEvent,
  makeSearchResult,
} from "./issue-opened.test-helpers.ts";

describe("createIssueOpenedHandler triage state", () => {
  let router: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    router = createMockEventRouter();
  });

  it("returns early when DB claim fails before expensive duplicate detection", async () => {
    let commentPosted = false;
    let embeddingCalls = 0;
    let searchCalls = 0;
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
      issueStore: {
        searchByEmbedding: async () => {
          searchCalls++;
          return [];
        },
      } as unknown as IssueStore,
      embeddingProvider: {
        generate: async () => {
          embeddingCalls++;
          return {
            embedding: new Float32Array([0.1, 0.2, 0.3]),
            model: "voyage-code-3",
            dimensions: 3,
          };
        },
        model: "voyage-code-3",
        dimensions: 3,
      },
      sql: createMockSql(),
      issueTriageStateStore: createIssueTriageStateStoreHarness({
        claimDeliveryId: null,
      }),
      logger: createMockLogger(),
    });

    await router.captured[0]!.handler(makeEvent());
    expect(commentPosted).toBe(false);
    expect(embeddingCalls).toBe(0);
    expect(searchCalls).toBe(0);
  });

  it("records duplicate count before posting a triage comment", async () => {
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
      makeSearchResult(51, "Another similar issue", "open", 0.12),
    ];
    const operationOrder: string[] = [];

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              operationOrder.push("create-comment");
              return { data: { id: 1234 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    const triageStateStore = createIssueTriageStateStoreHarness({
      onCall: (call) => {
        if (call.kind === "recordDuplicateCount") {
          operationOrder.push("record-duplicate-count");
        }
      },
    });

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

    const duplicateCountUpdate = triageStateStore.callsByKind("recordDuplicateCount")[0];
    expect(duplicateCountUpdate).toBeDefined();
    expect(duplicateCountUpdate!.input.duplicateCount).toBe(2);
    expect(duplicateCountUpdate!.deliveryId).toBe("delivery-1");
    expect(operationOrder).toEqual(["record-duplicate-count", "create-comment"]);
  });

  it("does not let a stale triage claim publish after a newer delivery reclaims the row", async () => {
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];
    let commentPosted = false;

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1234 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    const triageStateStore = createIssueTriageStateStoreHarness({
      claimDeliveryId: "stale-delivery",
      recordDuplicateCountResult: "stale",
    });

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

    await router.captured[0]!.handler(makeEvent({ id: "stale-delivery" }));

    const duplicateCountUpdate = triageStateStore.callsByKind("recordDuplicateCount")[0];
    expect(duplicateCountUpdate).toBeDefined();
    expect(duplicateCountUpdate!.deliveryId).toBe("stale-delivery");
    expect(commentPosted).toBe(false);
  });

  it("does not publish when the triage claim is superseded after duplicate count recording", async () => {
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];
    let commentPosted = false;
    let labelApplied = false;

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1234 } };
            },
            addLabels: async () => {
              labelApplied = true;
              return { data: [] };
            },
          },
        },
      }),
    } as unknown as GitHubApp;

    const triageStateStore = createIssueTriageStateStoreHarness({
      claimDeliveryId: "stale-delivery",
      recordDuplicateCountResult: "success",
      confirmPublishResult: false,
    });

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

    await router.captured[0]!.handler(makeEvent({ id: "stale-delivery" }));

    expect(triageStateStore.callsByKind("recordDuplicateCount")).toHaveLength(1);
    expect(triageStateStore.callsByKind("confirmPublish")).toHaveLength(1);
    expect(commentPosted).toBe(false);
    expect(labelApplied).toBe(false);
  });

  it("does not post a triage comment when duplicate count recording fails", async () => {
    const searchResults = [
      makeSearchResult(50, "Similar issue", "open", 0.1),
    ];
    let commentPosted = false;

    const githubApp = {
      getInstallationOctokit: async () => ({
        rest: {
          issues: {
            listComments: async () => ({ data: [] }),
            createComment: async () => {
              commentPosted = true;
              return { data: { id: 1234 } };
            },
            addLabels: async () => ({ data: [] }),
          },
        },
      }),
    } as unknown as GitHubApp;

    const triageStateStore = createIssueTriageStateStoreHarness({
      recordDuplicateCountResult: "error",
    });

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
    const claimCall = triageStateStore.callsByKind("claim")[0];
    expect(claimCall).toBeDefined();
    expect(claimCall!.input.deliveryId).toBe("delivery-123");
    expect(commentPosted).toBe(false);
  });
});
