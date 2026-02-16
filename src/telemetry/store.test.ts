import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync, rmSync } from "node:fs";
import { createTelemetryStore } from "./store.ts";
import type { TelemetryStore } from "./types.ts";
import type { ResilienceEventRecord } from "./types.ts";

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

function makeRecord(overrides: Partial<Parameters<TelemetryStore["record"]>[0]> = {}) {
  return {
    repo: "owner/repo",
    eventType: "pull_request.opened",
    model: "claude-sonnet-4-5-20250929",
    conclusion: "success",
    ...overrides,
  };
}

function makeRetrievalQualityRecord(
  overrides: Partial<Parameters<TelemetryStore["recordRetrievalQuality"]>[0]> = {},
) {
  return {
    repo: "owner/repo",
    eventType: "pull_request.opened",
    resultCount: 0,
    ...overrides,
  };
}

function makeResilienceEventRecord(overrides: Partial<ResilienceEventRecord> = {}): ResilienceEventRecord {
  return {
    deliveryId: "delivery-xyz",
    repo: "owner/repo",
    eventType: "pull_request.review_requested",
    kind: "timeout",
    ...overrides,
  };
}

/** Remove a temp SQLite database and its WAL/SHM sidecar files. */
function cleanupDb(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${path}${suffix}`);
    } catch {}
  }
}

describe("TelemetryStore", () => {
  let store: TelemetryStore;
  const tmpFiles: string[] = [];

  beforeEach(() => {
    store = createTelemetryStore({
      dbPath: ":memory:",
      logger: mockLogger,
    });
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
    for (const f of tmpFiles) {
      cleanupDb(f);
    }
    tmpFiles.length = 0;
  });

  /** Create a file-backed store for tests that need a second DB connection. */
  function createFileStore(): { store: TelemetryStore; path: string } {
    const path = `/tmp/kodiai-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    tmpFiles.push(path);
    return {
      store: createTelemetryStore({ dbPath: path, logger: mockLogger }),
      path,
    };
  }

  test("record() inserts a row with correct fields", () => {
    const { store: fileStore, path } = createFileStore();
    fileStore.record(
      makeRecord({
        deliveryId: "abc-123",
        repo: "octocat/hello-world",
        prNumber: 42,
        eventType: "pull_request.opened",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        durationMs: 3000,
        costUsd: 0.05,
        conclusion: "success",
        sessionId: "sess-001",
        numTurns: 5,
        stopReason: "end_turn",
      }),
    );

    const verifyDb = new Database(path, { readonly: true });
    const row = verifyDb
      .query("SELECT * FROM executions WHERE delivery_id = 'abc-123'")
      .get() as Record<string, unknown>;
    verifyDb.close();
    fileStore.close();

    expect(row).toBeTruthy();
    expect(row.repo).toBe("octocat/hello-world");
    expect(row.pr_number).toBe(42);
    expect(row.event_type).toBe("pull_request.opened");
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe("claude-sonnet-4-5-20250929");
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(500);
    expect(row.cache_read_tokens).toBe(200);
    expect(row.cache_creation_tokens).toBe(100);
    expect(row.duration_ms).toBe(3000);
    expect(row.cost_usd).toBe(0.05);
    expect(row.conclusion).toBe("success");
    expect(row.session_id).toBe("sess-001");
    expect(row.num_turns).toBe(5);
    expect(row.stop_reason).toBe("end_turn");
    expect(row.created_at).toBeTruthy();
  });

  test("record() with minimal fields applies defaults", () => {
    const { store: fileStore, path } = createFileStore();
    fileStore.record(makeRecord());

    const verifyDb = new Database(path, { readonly: true });
    const row = verifyDb.query("SELECT * FROM executions LIMIT 1").get() as Record<string, unknown>;
    verifyDb.close();
    fileStore.close();

    expect(row).toBeTruthy();
    expect(row.provider).toBe("anthropic");
    expect(row.input_tokens).toBe(0);
    expect(row.output_tokens).toBe(0);
    expect(row.cache_read_tokens).toBe(0);
    expect(row.cache_creation_tokens).toBe(0);
    expect(row.duration_ms).toBe(0);
    expect(row.cost_usd).toBe(0);
    expect(row.delivery_id).toBeNull();
    expect(row.pr_number).toBeNull();
    expect(row.session_id).toBeNull();
    expect(row.num_turns).toBeNull();
    expect(row.stop_reason).toBeNull();
  });

  test("purgeOlderThan(0) deletes all rows and returns count", () => {
    const { store: fileStore, path } = createFileStore();
    fileStore.record(makeRecord());

    // Manually backdate the row so it's older than 0 days ago
    const db = new Database(path);
    db.run("UPDATE executions SET created_at = datetime('now', '-1 day')");
    db.close();

    const purged = fileStore.purgeOlderThan(0);
    fileStore.close();

    expect(purged).toBe(1);
  });

  test("purgeOlderThan(90) preserves recent rows", () => {
    const { store: fileStore, path } = createFileStore();
    fileStore.record(makeRecord());

    const purged = fileStore.purgeOlderThan(90);

    expect(purged).toBe(0);

    // Verify row still exists
    const verifyDb = new Database(path, { readonly: true });
    const result = verifyDb.query("SELECT COUNT(*) as cnt FROM executions").get() as { cnt: number };
    verifyDb.close();
    fileStore.close();

    expect(result.cnt).toBe(1);
  });

  test("checkpoint() runs without error", () => {
    store.record(makeRecord());
    expect(() => store.checkpoint()).not.toThrow();
  });

  test("WAL mode is active after initialization", () => {
    const { store: fileStore, path } = createFileStore();

    const verifyDb = new Database(path, { readonly: true });
    const result = verifyDb.query("PRAGMA journal_mode").get() as { journal_mode: string };
    verifyDb.close();
    fileStore.close();

    expect(result.journal_mode).toBe("wal");
  });

  test("close() prevents subsequent operations", () => {
    store.close();
    expect(() => store.record(makeRecord())).toThrow();
  });

  test("auto-checkpoint triggers after 1000 writes", () => {
    // Insert 1000 records -- auto-checkpoint fires at the 1000th write
    for (let i = 0; i < 1000; i++) {
      store.record(makeRecord({ deliveryId: `write-${i}` }));
    }

    // DB should remain functional after checkpoint
    expect(() => store.record(makeRecord({ deliveryId: "write-1001" }))).not.toThrow();
  });

  test("recordRetrievalQuality() inserts a row and is idempotent by delivery_id", () => {
    const { store: fileStore, path } = createFileStore();

    fileStore.recordRetrievalQuality(
      makeRetrievalQualityRecord({
        deliveryId: "deliv-001",
        repo: "octocat/hello-world",
        prNumber: 123,
        eventType: "pull_request.opened",
        topK: 8,
        distanceThreshold: 0.3,
        resultCount: 2,
        avgDistance: 0.25,
        languageMatchRatio: 0.5,
      }),
    );

    // Duplicate delivery id should not create a second row.
    fileStore.recordRetrievalQuality(
      makeRetrievalQualityRecord({
        deliveryId: "deliv-001",
        repo: "octocat/hello-world",
        prNumber: 123,
        eventType: "pull_request.opened",
        topK: 8,
        distanceThreshold: 0.3,
        resultCount: 2,
        avgDistance: 0.25,
        languageMatchRatio: 0.5,
      }),
    );

    const verifyDb = new Database(path, { readonly: true });
    const row = verifyDb
      .query("SELECT * FROM retrieval_quality WHERE delivery_id = 'deliv-001'")
      .get() as Record<string, unknown>;
    const count = verifyDb
      .query("SELECT COUNT(*) as cnt FROM retrieval_quality WHERE delivery_id = 'deliv-001'")
      .get() as { cnt: number };
    verifyDb.close();
    fileStore.close();

    expect(row).toBeTruthy();
    expect(row.repo).toBe("octocat/hello-world");
    expect(row.pr_number).toBe(123);
    expect(row.event_type).toBe("pull_request.opened");
    expect(row.top_k).toBe(8);
    expect(row.distance_threshold).toBe(0.3);
    expect(row.result_count).toBe(2);
    expect(row.avg_distance).toBe(0.25);
    expect(row.language_match_ratio).toBe(0.5);
    expect(row.created_at).toBeTruthy();
    expect(count.cnt).toBe(1);
  });

  test("auto-checkpoint counts retrieval quality writes", () => {
    // 999 execution writes + 1 retrieval quality write => checkpoint threshold hit
    for (let i = 0; i < 999; i++) {
      store.record(makeRecord({ deliveryId: `mixed-${i}` }));
    }
    store.recordRetrievalQuality(
      makeRetrievalQualityRecord({
        deliveryId: "mixed-999",
        resultCount: 1,
        avgDistance: 0.1,
        languageMatchRatio: 1,
      }),
    );

    // DB should remain functional after checkpoint
    expect(() => store.record(makeRecord({ deliveryId: "mixed-1000" }))).not.toThrow();
  });

  test("creates data directory if it does not exist", () => {
    const baseDir = `/tmp/kodiai-test-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nestedDir = `${baseDir}/nested/path`;
    const dbPath = `${nestedDir}/test.db`;

    expect(existsSync(nestedDir)).toBe(false);

    const dirStore = createTelemetryStore({ dbPath, logger: mockLogger });
    dirStore.record(makeRecord());
    dirStore.close();

    expect(existsSync(nestedDir)).toBe(true);

    // Cleanup
    try {
      rmSync(baseDir, { recursive: true });
    } catch {}
  });

  test("indexes exist on created_at and repo columns", () => {
    const { store: fileStore, path } = createFileStore();

    const verifyDb = new Database(path, { readonly: true });
    const indexes = verifyDb
      .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='executions'")
      .all() as Array<{ name: string }>;
    verifyDb.close();
    fileStore.close();

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_executions_created_at");
    expect(indexNames).toContain("idx_executions_repo");
  });

  test("recordResilienceEvent() inserts a row and is idempotent by delivery_id", () => {
    const { store: fileStore, path } = createFileStore();

    expect(typeof fileStore.recordResilienceEvent).toBe("function");

    fileStore.recordResilienceEvent?.(
      makeResilienceEventRecord({
        deliveryId: "res-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        prAuthor: "octocat",
        kind: "timeout",
        eventType: "pull_request.opened",
        reviewOutputKey: "rok-1",
        executionConclusion: "timeout",
        checkpointFilesReviewed: 3,
        checkpointFindingCount: 2,
        checkpointTotalFiles: 10,
        partialCommentId: 123,
        retryEnqueued: true,
        retryFilesCount: 4,
        retryScopeRatio: 0.6,
        retryTimeoutSeconds: 120,
        retryRiskLevel: "medium",
        retryCheckpointEnabled: true,
      }),
    );

    // Re-write same delivery id with different fields.
    fileStore.recordResilienceEvent?.(
      makeResilienceEventRecord({
        deliveryId: "res-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        prAuthor: "octocat",
        kind: "timeout",
        eventType: "pull_request.opened",
        executionConclusion: "timeout_partial",
        checkpointFilesReviewed: 4,
      }),
    );

    const verifyDb = new Database(path, { readonly: true });
    const row = verifyDb
      .query("SELECT * FROM resilience_events WHERE delivery_id = 'res-001'")
      .get() as Record<string, unknown>;
    const count = verifyDb
      .query("SELECT COUNT(*) as cnt FROM resilience_events WHERE delivery_id = 'res-001'")
      .get() as { cnt: number };
    verifyDb.close();
    fileStore.close();

    expect(count.cnt).toBe(1);
    expect(row.repo).toBe("octocat/hello-world");
    expect(row.pr_number).toBe(7);
    expect(row.pr_author).toBe("octocat");
    expect(row.kind).toBe("timeout");
    expect(row.execution_conclusion).toBe("timeout_partial");
    expect(row.checkpoint_files_reviewed).toBe(4);
    expect(row.created_at).toBeTruthy();
  });
});
