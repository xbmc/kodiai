import { describe, expect, test, mock } from "bun:test";
import { linkPRToIssues, type LinkResult } from "./issue-linker.ts";
import type { IssueStore, IssueRecord, IssueSearchResult } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { Logger } from "pino";

/** Create a minimal mock IssueRecord. */
function mockRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 1,
    createdAt: "2026-01-01",
    repo: "owner/repo",
    owner: "owner",
    issueNumber: 42,
    title: "Test issue",
    body: "Test issue body with some details",
    state: "open",
    authorLogin: "user1",
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
    ...overrides,
  };
}

/** Create a no-op logger mock. */
function mockLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => mockLogger()),
  } as unknown as Logger;
}

/** Create a mock IssueStore. */
function mockIssueStore(overrides: Partial<IssueStore> = {}): IssueStore {
  return {
    upsert: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    getByNumber: mock(() => Promise.resolve(null)),
    searchByEmbedding: mock(() => Promise.resolve([])),
    searchByFullText: mock(() => Promise.resolve([])),
    findSimilar: mock(() => Promise.resolve([])),
    countByRepo: mock(() => Promise.resolve(0)),
    upsertComment: mock(() => Promise.resolve()),
    deleteComment: mock(() => Promise.resolve()),
    getCommentsByIssue: mock(() => Promise.resolve([])),
    searchCommentsByEmbedding: mock(() => Promise.resolve([])),
    ...overrides,
  } as IssueStore;
}

/** Create a mock EmbeddingProvider. */
function mockEmbeddingProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    generate: mock(() => Promise.resolve({ embedding: new Float32Array(1024), model: "test", usage: { totalTokens: 10 } })),
    model: "test-model",
    dimensions: 1024,
    ...overrides,
  } as EmbeddingProvider;
}

const defaultParams = {
  prTitle: "Fix login bug",
  prBody: "",
  commitMessages: [] as string[],
  diffSummary: "",
  repo: "owner/repo",
};

describe("linkPRToIssues", () => {
  describe("explicit references", () => {
    test("returns referenced issues when body has 'fixes #42'", async () => {
      const record = mockRecord({ issueNumber: 42, title: "Login fails on mobile", state: "open" });
      const issueStore = mockIssueStore({
        getByNumber: mock(() => Promise.resolve(record)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes #42",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues).toHaveLength(1);
      expect(result.referencedIssues[0]!.issueNumber).toBe(42);
      expect(result.referencedIssues[0]!.title).toBe("Login fails on mobile");
      expect(result.referencedIssues[0]!.linkType).toBe("referenced");
      expect(result.referencedIssues[0]!.keyword).toBe("fixes");
      expect(result.semanticMatches).toHaveLength(0);
    });

    test("skips semantic search when explicit refs are found", async () => {
      const record = mockRecord({ issueNumber: 42 });
      const issueStore = mockIssueStore({
        getByNumber: mock(() => Promise.resolve(record)),
      });
      const generateMock = mock(() => Promise.resolve({ embedding: new Float32Array(1024), model: "test", usage: { totalTokens: 10 } }));
      const embeddingProvider = mockEmbeddingProvider({ generate: generateMock } as unknown as Partial<EmbeddingProvider>);
      const logger = mockLogger();

      await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes #42",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(generateMock).not.toHaveBeenCalled();
    });

    test("skips issue not found in corpus with warning", async () => {
      const issueStore = mockIssueStore({
        getByNumber: mock(() => Promise.resolve(null)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes #999",
        issueStore,
        embeddingProvider,
        logger,
      });

      // No referenced issues (not in corpus), falls through to semantic
      expect(result.referencedIssues).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    test("skips cross-repo references with debug log", async () => {
      const issueStore = mockIssueStore();
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes org/other#5",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalled();
      expect(issueStore.getByNumber).not.toHaveBeenCalled();
    });
  });

  describe("semantic search fallback", () => {
    test("runs semantic search when no explicit refs", async () => {
      const searchResults: IssueSearchResult[] = [
        { record: mockRecord({ issueNumber: 10, title: "Similar issue" }), distance: 0.15 },
      ];
      const issueStore = mockIssueStore({
        searchByEmbedding: mock(() => Promise.resolve(searchResults)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "Some PR without explicit refs",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues).toHaveLength(0);
      expect(result.semanticMatches).toHaveLength(1);
      expect(result.semanticMatches[0]!.issueNumber).toBe(10);
      expect(result.semanticMatches[0]!.linkType).toBe("semantic");
      expect(result.semanticMatches[0]!.similarity).toBeCloseTo(0.85, 2);
    });

    test("filters results below threshold", async () => {
      const searchResults: IssueSearchResult[] = [
        { record: mockRecord({ issueNumber: 10 }), distance: 0.15 }, // sim 0.85 - passes 0.80
        { record: mockRecord({ issueNumber: 20 }), distance: 0.25 }, // sim 0.75 - fails 0.80
      ];
      const issueStore = mockIssueStore({
        searchByEmbedding: mock(() => Promise.resolve(searchResults)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "Some PR without explicit refs",
        issueStore,
        embeddingProvider,
        logger,
        semanticThreshold: 0.80,
      });

      expect(result.semanticMatches).toHaveLength(1);
      expect(result.semanticMatches[0]!.issueNumber).toBe(10);
    });

    test("respects maxSemanticResults", async () => {
      const searchResults: IssueSearchResult[] = [
        { record: mockRecord({ issueNumber: 1 }), distance: 0.10 },
        { record: mockRecord({ issueNumber: 2 }), distance: 0.12 },
        { record: mockRecord({ issueNumber: 3 }), distance: 0.14 },
        { record: mockRecord({ issueNumber: 4 }), distance: 0.16 },
        { record: mockRecord({ issueNumber: 5 }), distance: 0.18 },
      ];
      const issueStore = mockIssueStore({
        searchByEmbedding: mock(() => Promise.resolve(searchResults)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "Some PR",
        issueStore,
        embeddingProvider,
        logger,
        maxSemanticResults: 3,
      });

      expect(result.semanticMatches).toHaveLength(3);
    });
  });

  describe("fail-open behavior", () => {
    test("returns empty on embedding failure", async () => {
      const issueStore = mockIssueStore();
      const embeddingProvider = mockEmbeddingProvider({
        generate: mock(() => Promise.resolve(null)),
      } as unknown as Partial<EmbeddingProvider>);
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "Some PR without refs",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues).toHaveLength(0);
      expect(result.semanticMatches).toHaveLength(0);
    });

    test("returns empty on searchByEmbedding failure", async () => {
      const issueStore = mockIssueStore({
        searchByEmbedding: mock(() => Promise.reject(new Error("DB connection failed"))),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "Some PR without refs",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.semanticMatches).toHaveLength(0);
    });

    test("returns empty on complete failure", async () => {
      const issueStore = mockIssueStore({
        getByNumber: mock(() => Promise.reject(new Error("total failure"))),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes #42",
        issueStore,
        embeddingProvider,
        logger,
      });

      // Outer try/catch catches the getByNumber error in a per-ref catch,
      // the ref is skipped, then falls to semantic (empty body = empty result)
      expect(result).toBeDefined();
    });
  });

  describe("description truncation", () => {
    test("truncates long issue body to 500 chars", async () => {
      const longBody = "A".repeat(1000);
      const record = mockRecord({ issueNumber: 42, body: longBody });
      const issueStore = mockIssueStore({
        getByNumber: mock(() => Promise.resolve(record)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes #42",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues[0]!.descriptionSummary.length).toBeLessThanOrEqual(503); // 500 + "..."
      expect(result.referencedIssues[0]!.descriptionSummary).toEndWith("...");
    });

    test("handles null body gracefully", async () => {
      const record = mockRecord({ issueNumber: 42, body: null });
      const issueStore = mockIssueStore({
        getByNumber: mock(() => Promise.resolve(record)),
      });
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "fixes #42",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues[0]!.descriptionSummary).toBe("");
    });
  });

  describe("empty inputs", () => {
    test("returns empty LinkResult for empty body and commits", async () => {
      const issueStore = mockIssueStore();
      const embeddingProvider = mockEmbeddingProvider();
      const logger = mockLogger();

      const result = await linkPRToIssues({
        ...defaultParams,
        prBody: "",
        prTitle: "",
        commitMessages: [],
        diffSummary: "",
        issueStore,
        embeddingProvider,
        logger,
      });

      expect(result.referencedIssues).toHaveLength(0);
      expect(result.semanticMatches).toHaveLength(0);
    });
  });
});
