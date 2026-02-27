import { describe, test, expect } from "bun:test";
import {
  retrieveTroubleshootingContext,
  extractKeywords,
  type TroubleshootingConfig,
} from "./troubleshooting-retrieval.ts";
import type { IssueStore, IssueRecord, IssueCommentRecord } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { WikiPageStore } from "./wiki-types.ts";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as import("pino").Logger;

function makeEmbedding(seed: number = 42): Float32Array {
  const arr = new Float32Array(8);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = ((seed * (i + 1) * 7919) % 1000) / 1000;
  }
  return arr;
}

function makeIssueRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 1,
    createdAt: "2025-01-01",
    repo: "owner/repo",
    owner: "owner",
    issueNumber: 100,
    title: "Resolved issue",
    body: "Fixed by updating the config",
    state: "closed",
    authorLogin: "alice",
    authorAssociation: "NONE",
    labelNames: [],
    templateSlug: null,
    commentCount: 2,
    assignees: [],
    milestone: null,
    reactionCount: 0,
    isPullRequest: false,
    locked: false,
    embedding: null,
    embeddingModel: null,
    githubCreatedAt: "2025-01-01",
    githubUpdatedAt: null,
    closedAt: "2025-01-15",
    ...overrides,
  };
}

function makeComment(overrides: Partial<IssueCommentRecord> = {}): IssueCommentRecord {
  return {
    id: 1,
    createdAt: "2025-01-01",
    repo: "owner/repo",
    issueNumber: 100,
    commentGithubId: 5000,
    authorLogin: "bob",
    authorAssociation: "MEMBER",
    body: "This was fixed in v2.1",
    embedding: null,
    embeddingModel: null,
    githubCreatedAt: "2025-01-10T00:00:00Z",
    githubUpdatedAt: null,
    ...overrides,
  };
}

const defaultConfig: TroubleshootingConfig = {
  enabled: true,
  similarityThreshold: 0.65,
  maxResults: 3,
  totalBudgetChars: 12000,
};

const mockEmbeddingProvider: EmbeddingProvider = {
  generate: async () => ({ embedding: makeEmbedding(), model: "test", dimensions: 8 }),
  model: "test",
  dimensions: 8,
};

function createMockIssueStore(overrides: Partial<IssueStore> = {}): IssueStore {
  return {
    upsert: async () => {},
    delete: async () => {},
    getByNumber: async (_repo, issueNumber) => makeIssueRecord({ issueNumber }),
    searchByEmbedding: async () => [],
    searchByFullText: async () => [],
    findSimilar: async () => [],
    countByRepo: async () => 0,
    upsertComment: async () => {},
    deleteComment: async () => {},
    getCommentsByIssue: async () => [
      makeComment({ commentGithubId: 5001, body: "Initial investigation", githubCreatedAt: "2025-01-05T00:00:00Z" }),
      makeComment({ commentGithubId: 5002, body: "Applied the fix", githubCreatedAt: "2025-01-10T00:00:00Z" }),
    ],
    searchCommentsByEmbedding: async () => [],
    ...overrides,
  };
}

function createMockWikiPageStore(): WikiPageStore {
  return {
    writeChunks: async () => {},
    deletePageChunks: async () => {},
    replacePageChunks: async () => {},
    softDeletePage: async () => {},
    searchByEmbedding: async () => [
      {
        record: {
          id: 1, createdAt: "2025-01-01", pageId: 10,
          pageTitle: "Troubleshooting Guide", namespace: "main",
          pageUrl: "https://wiki.example.com/troubleshooting",
          sectionHeading: "Common Issues", sectionAnchor: "common",
          sectionLevel: 2, chunkIndex: 0,
          chunkText: "If you see this error, update config.yml",
          rawText: "If you see this error, update config.yml",
          tokenCount: 10, embedding: null, embeddingModel: null,
          stale: false, lastModified: null, revisionId: null,
          deleted: false, languageTags: [],
        },
        distance: 0.3,
      },
    ],
    searchByFullText: async () => [],
    getPageChunks: async () => [],
    getSyncState: async () => null,
    updateSyncState: async () => {},
    countBySource: async () => 0,
    getPageRevision: async () => null,
  };
}

describe("extractKeywords", () => {
  test("extracts quoted error messages", () => {
    const result = extractKeywords(
      "App crashes on startup",
      'When I run the app, I get "TypeError: Cannot read property \'x\' of undefined" and it crashes.',
    );
    expect(result).toContain("TypeError: Cannot read property 'x' of undefined");
  });

  test("extracts component-like names", () => {
    const result = extractKeywords("VideoPlayer crashes on HDR", "The VideoPlayer component fails when HDR is enabled");
    expect(result).toContain("VideoPlayer");
  });

  test("returns title when body is null", () => {
    const result = extractKeywords("Database connection timeout", null);
    expect(result).toContain("Database");
    expect(result).toContain("connection");
    expect(result).toContain("timeout");
  });

  test("handles empty strings", () => {
    const result = extractKeywords("", null);
    expect(result).toBe("");
  });
});

describe("retrieveTroubleshootingContext", () => {
  test("returns resolved issue matches with assembled threads", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [
        { record: makeIssueRecord({ issueNumber: 50 }), distance: 0.2 },
        { record: makeIssueRecord({ issueNumber: 51 }), distance: 0.25 },
      ],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "App crashes on startup",
      queryBody: "Error in config loading",
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("issues");
    expect(result!.matches.length).toBe(2);
    expect(result!.matches[0]!.title).toBe("Resolved issue");
    expect(result!.matches[0]!.body.length).toBeGreaterThan(0);
  });

  test("filters by state='closed' -- stateFilter passed to store", async () => {
    let capturedStateFilter: string | undefined;
    const store = createMockIssueStore({
      searchByEmbedding: async (params) => {
        capturedStateFilter = params.stateFilter;
        return [
          { record: makeIssueRecord({ issueNumber: 50 }), distance: 0.2 },
        ];
      },
    });

    await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(capturedStateFilter).toBe("closed");
  });

  test("applies similarity floor", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [
        { record: makeIssueRecord({ issueNumber: 50 }), distance: 0.2 },  // sim 0.8 > 0.65 threshold
        { record: makeIssueRecord({ issueNumber: 51 }), distance: 0.3 },  // sim 0.7 > 0.65 threshold
        { record: makeIssueRecord({ issueNumber: 52 }), distance: 0.5 },  // sim 0.5 < 0.65 threshold
      ],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.matches.length).toBe(2);
  });

  test("excludes pull request records", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [
        { record: makeIssueRecord({ issueNumber: 50, isPullRequest: true }), distance: 0.2 },
        { record: makeIssueRecord({ issueNumber: 51, isPullRequest: false }), distance: 0.25 },
      ],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.matches.length).toBe(1);
    expect(result!.matches[0]!.issueNumber).toBe(51);
  });

  test("respects maxResults config", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [
        { record: makeIssueRecord({ issueNumber: 50 }), distance: 0.1 },
        { record: makeIssueRecord({ issueNumber: 51 }), distance: 0.15 },
        { record: makeIssueRecord({ issueNumber: 52 }), distance: 0.2 },
        { record: makeIssueRecord({ issueNumber: 53 }), distance: 0.25 },
        { record: makeIssueRecord({ issueNumber: 54 }), distance: 0.3 },
      ],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: { ...defaultConfig, maxResults: 2 },
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.matches.length).toBe(2);
  });

  test("falls back to wiki when no resolved issues match", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [],
      searchByFullText: async () => [],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      wikiPageStore: createMockWikiPageStore(),
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "How to configure SSL",
      queryBody: "Getting SSL handshake errors",
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("wiki");
    expect(result!.wikiResults.length).toBeGreaterThan(0);
    expect(result!.matches.length).toBe(0);
  });

  test("returns null when both issues and wiki return nothing", async () => {
    const emptyWikiStore = createMockWikiPageStore();
    emptyWikiStore.searchByEmbedding = async () => [];

    const store = createMockIssueStore({
      searchByEmbedding: async () => [],
      searchByFullText: async () => [],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      wikiPageStore: emptyWikiStore,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Obscure issue",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).toBeNull();
  });

  test("returns null when embedding generation fails", async () => {
    const failingProvider: EmbeddingProvider = {
      generate: async () => null,
      model: "test",
      dimensions: 8,
    };

    const result = await retrieveTroubleshootingContext({
      issueStore: createMockIssueStore(),
      embeddingProvider: failingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).toBeNull();
  });

  test("budget is distributed by similarity weight", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [
        { record: makeIssueRecord({ issueNumber: 50 }), distance: 0.1 },  // higher similarity
        { record: makeIssueRecord({ issueNumber: 51 }), distance: 0.3 },  // lower similarity
      ],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).not.toBeNull();
    expect(result!.matches.length).toBe(2);
    // First match (higher similarity) should have more chars
    expect(result!.matches[0]!.totalChars).toBeGreaterThanOrEqual(result!.matches[1]!.totalChars);
  });

  test("wiki fallback uses dual query", async () => {
    let wikiSearchCount = 0;
    const wikiStore = createMockWikiPageStore();
    wikiStore.searchByEmbedding = async () => {
      wikiSearchCount++;
      return [{
        record: {
          id: 1, createdAt: "2025-01-01", pageId: 10 + wikiSearchCount,
          pageTitle: `Page ${wikiSearchCount}`, namespace: "main",
          pageUrl: `https://wiki.example.com/page${wikiSearchCount}`,
          sectionHeading: null, sectionAnchor: null, sectionLevel: null,
          chunkIndex: 0, chunkText: "content", rawText: "content",
          tokenCount: 5, embedding: null, embeddingModel: null,
          stale: false, lastModified: null, revisionId: null,
          deleted: false, languageTags: [],
        },
        distance: 0.3,
      }];
    };

    const store = createMockIssueStore({
      searchByEmbedding: async () => [],
      searchByFullText: async () => [],
    });

    await retrieveTroubleshootingContext({
      issueStore: store,
      wikiPageStore: wikiStore,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "SSL configuration error",
      queryBody: 'Got "SSL handshake failed" when connecting',
      config: defaultConfig,
      logger: mockLogger,
    });

    // searchWikiPages is called twice (original + keyword query),
    // each call generates an embedding, so wikiStore.searchByEmbedding is called at least 2 times
    expect(wikiSearchCount).toBeGreaterThanOrEqual(2);
  });

  test("returns null when no wiki store available for fallback", async () => {
    const store = createMockIssueStore({
      searchByEmbedding: async () => [],
      searchByFullText: async () => [],
    });

    const result = await retrieveTroubleshootingContext({
      issueStore: store,
      embeddingProvider: mockEmbeddingProvider,
      repo: "owner/repo",
      queryTitle: "Test",
      queryBody: null,
      config: defaultConfig,
      logger: mockLogger,
    });

    expect(result).toBeNull();
  });
});
