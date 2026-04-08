import { describe, it, expect, beforeEach, mock } from "bun:test";
import { sweepNullEmbeddings } from "./review-comment-embedding-sweep.ts";
import type { ReviewCommentRecord, ReviewCommentStore } from "./review-comment-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { Logger } from "pino";

// ── Mock helpers ────────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  } as unknown as Logger;
}

function createMockEmbeddingProvider(opts?: {
  shouldFail?: boolean;
  shouldThrow?: boolean;
}): EmbeddingProvider {
  return {
    async generate(_text: string, _inputType: "document" | "query") {
      if (opts?.shouldThrow) throw new Error("VoyageAI unavailable");
      if (opts?.shouldFail) return null;
      return {
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        model: "voyage-4",
        dimensions: 1024,
      };
    },
    get model() {
      return "voyage-4";
    },
    get dimensions() {
      return 1024;
    },
  };
}

function makeRecord(id: number, chunkText = `chunk-${id}`): ReviewCommentRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00Z",
    repo: "owner/repo",
    owner: "owner",
    prNumber: 1,
    prTitle: "Test PR",
    commentGithubId: 1000 + id,
    threadId: `thread-${id}`,
    inReplyToId: null,
    filePath: "src/test.ts",
    startLine: 1,
    endLine: 10,
    diffHunk: "@@ -1,3 +1,5 @@",
    authorLogin: "dev",
    authorAssociation: "MEMBER",
    body: "test comment",
    chunkIndex: 0,
    chunkText,
    tokenCount: 10,
    embedding: null,
    embeddingModel: null,
    stale: false,
    githubCreatedAt: "2026-01-01T00:00:00Z",
    githubUpdatedAt: null,
    deleted: false,
    backfillBatch: null,
  };
}

function createMockStore(overrides?: Partial<ReviewCommentStore>): ReviewCommentStore {
  return {
    writeChunks: mock(async () => {}),
    softDelete: mock(async () => {}),
    updateChunks: mock(async () => {}),
    searchByEmbedding: mock(async () => []),
    searchByFullText: mock(async () => []),
    getThreadComments: mock(async () => []),
    getSyncState: mock(async () => null),
    updateSyncState: mock(async () => {}),
    getLatestCommentDate: mock(async () => null),
    countByRepo: mock(async () => 0),
    getNullEmbeddingChunks: mock(async () => []),
    updateEmbedding: mock(async () => {}),
    countNullEmbeddings: mock(async () => 0),
    getByGithubId: mock(async () => null),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sweepNullEmbeddings", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it("returns zeroed result when 0 null-embedding chunks exist", async () => {
    const store = createMockStore({
      countNullEmbeddings: mock(async () => 0),
    });
    const embeddingProvider = createMockEmbeddingProvider();

    const result = await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      logger,
      batchDelayMs: 1,
    });

    expect(result.totalNull).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // Should not have called getNullEmbeddingChunks
    expect(store.getNullEmbeddingChunks).not.toHaveBeenCalled();
  });

  it("processes chunks in batches until empty batch returned", async () => {
    const batch1 = [makeRecord(1), makeRecord(2)];
    const batch2 = [makeRecord(3)];
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 3),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return batch1;
        if (callCount === 2) return batch2;
        return [];
      }),
    });
    const embeddingProvider = createMockEmbeddingProvider();

    const result = await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchSize: 2,
      batchDelayMs: 1,
      logger,
    });

    expect(result.totalNull).toBe(3);
    expect(result.processed).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    // getNullEmbeddingChunks called 3 times: 2 with data, 1 empty
    expect(store.getNullEmbeddingChunks).toHaveBeenCalledTimes(3);
  });

  it("calls embeddingProvider.generate with chunkText and 'document' inputType", async () => {
    const generateFn = mock(async () => ({
      embedding: new Float32Array([0.1, 0.2]),
      model: "voyage-4",
      dimensions: 1024,
    }));
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 1),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return [makeRecord(1, "hello world")];
        return [];
      }),
    });

    const embeddingProvider = {
      generate: generateFn,
      get model() { return "voyage-4"; },
      get dimensions() { return 1024; },
    } as unknown as EmbeddingProvider;

    await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchDelayMs: 1,
      logger,
    });

    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(generateFn).toHaveBeenCalledWith("hello world", "document");
  });

  it("calls store.updateEmbedding with generated embedding and model", async () => {
    const embedding = new Float32Array([0.5, 0.6, 0.7]);
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 1),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return [makeRecord(42)];
        return [];
      }),
    });

    const embeddingProvider = {
      async generate() {
        return { embedding, model: "voyage-4", dimensions: 1024 };
      },
      get model() { return "voyage-4"; },
      get dimensions() { return 1024; },
    } as unknown as EmbeddingProvider;

    await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchDelayMs: 1,
      logger,
    });

    expect(store.updateEmbedding).toHaveBeenCalledTimes(1);
    expect(store.updateEmbedding).toHaveBeenCalledWith(42, embedding, "voyage-4");
  });

  it("skips chunks where embeddingProvider.generate returns null", async () => {
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 2),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return [makeRecord(1), makeRecord(2)];
        return [];
      }),
    });
    const embeddingProvider = createMockEmbeddingProvider({ shouldFail: true });

    const result = await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchDelayMs: 1,
      logger,
    });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(store.updateEmbedding).not.toHaveBeenCalled();
    // Should log warnings
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips chunks where embeddingProvider.generate throws and continues", async () => {
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 2),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return [makeRecord(1), makeRecord(2)];
        return [];
      }),
    });
    const embeddingProvider = createMockEmbeddingProvider({ shouldThrow: true });

    const result = await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchDelayMs: 1,
      logger,
    });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(store.updateEmbedding).not.toHaveBeenCalled();
    // Should log errors
    expect(logger.error).toHaveBeenCalled();
  });

  it("respects maxBatches limit", async () => {
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 100),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        // Always return a full batch
        return [makeRecord(callCount * 10 + 1), makeRecord(callCount * 10 + 2)];
      }),
    });
    const embeddingProvider = createMockEmbeddingProvider();

    const result = await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchSize: 2,
      maxBatches: 2,
      batchDelayMs: 1,
      logger,
    });

    // Should process exactly 2 batches = 4 chunks
    expect(result.processed).toBe(4);
    expect(result.succeeded).toBe(4);
    expect(store.getNullEmbeddingChunks).toHaveBeenCalledTimes(2);
  });

  it("does not call updateEmbedding in dryRun mode", async () => {
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 1),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return [makeRecord(1)];
        return [];
      }),
    });
    const embeddingProvider = createMockEmbeddingProvider();

    const result = await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchDelayMs: 1,
      dryRun: true,
      logger,
    });

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(store.updateEmbedding).not.toHaveBeenCalled();
  });

  it("logs start with totalNull count and end with summary stats", async () => {
    let callCount = 0;

    const store = createMockStore({
      countNullEmbeddings: mock(async () => 2),
      getNullEmbeddingChunks: mock(async () => {
        callCount++;
        if (callCount === 1) return [makeRecord(1), makeRecord(2)];
        return [];
      }),
    });
    const embeddingProvider = createMockEmbeddingProvider();

    await sweepNullEmbeddings({
      store,
      embeddingProvider,
      repo: "owner/repo",
      batchDelayMs: 1,
      logger,
    });

    const infoCalls = (logger.info as ReturnType<typeof mock>).mock.calls;

    // First info call should contain totalNull
    const startLog = infoCalls[0];
    expect(startLog).toBeDefined();
    expect(startLog![0]).toMatchObject({ repo: "owner/repo", totalNull: 2 });

    // Last info call should contain completion stats
    const endLog = infoCalls[infoCalls.length - 1];
    expect(endLog).toBeDefined();
    expect(endLog![0]).toMatchObject({
      repo: "owner/repo",
      totalNull: 2,
      processed: 2,
      succeeded: 2,
      failed: 0,
    });
    // durationMs should be present
    expect(endLog![0]).toHaveProperty("durationMs");
  });
});
