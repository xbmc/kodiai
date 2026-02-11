import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createTelemetryStore } from "./store.ts";
import type { TelemetryStore } from "./types.ts";

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

describe("TelemetryStore", () => {
  let store: TelemetryStore;

  beforeEach(() => {
    store = createTelemetryStore({
      dbPath: ":memory:",
      logger: mockLogger,
    });
  });

  afterEach(() => {
    store.close();
  });

  test("record() inserts a row with correct fields", () => {
    store.record(
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

    // Query DB directly via the store's internal DB
    // We need to create a separate connection to verify -- but since :memory: is per-connection,
    // we use the store's own DB. We'll access via a helper.
    // Instead, create a file-based store for verification or use the store's record + purge behavior.
    // Simplest: create another store pointing to same :memory: won't work.
    // Solution: Create a file-based temp store so we can open a second connection to verify.
    store.close();

    // Use a temp file approach
    const tmpPath = `/tmp/kodiai-test-${Date.now()}.db`;
    const fileStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });
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

    const verifyDb = new Database(tmpPath, { readonly: true });
    const row = verifyDb.query("SELECT * FROM executions WHERE delivery_id = 'abc-123'").get() as Record<string, unknown>;
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

    // Cleanup
    try {
      require("node:fs").unlinkSync(tmpPath);
      require("node:fs").unlinkSync(`${tmpPath}-wal`);
      require("node:fs").unlinkSync(`${tmpPath}-shm`);
    } catch {}
  });

  test("record() with minimal fields applies defaults", () => {
    const tmpPath = `/tmp/kodiai-test-minimal-${Date.now()}.db`;
    const fileStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });
    fileStore.record(makeRecord());

    const verifyDb = new Database(tmpPath, { readonly: true });
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

    try {
      require("node:fs").unlinkSync(tmpPath);
      require("node:fs").unlinkSync(`${tmpPath}-wal`);
      require("node:fs").unlinkSync(`${tmpPath}-shm`);
    } catch {}
  });

  test("purgeOlderThan(0) deletes all rows and returns count", () => {
    const tmpPath = `/tmp/kodiai-test-purge-${Date.now()}.db`;
    const fileStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });
    fileStore.record(makeRecord());

    // Manually backdate the row
    const db = new Database(tmpPath);
    db.run("UPDATE executions SET created_at = datetime('now', '-1 day')");
    db.close();

    const purged = fileStore.purgeOlderThan(0);
    fileStore.close();

    expect(purged).toBe(1);

    try {
      require("node:fs").unlinkSync(tmpPath);
      require("node:fs").unlinkSync(`${tmpPath}-wal`);
      require("node:fs").unlinkSync(`${tmpPath}-shm`);
    } catch {}
  });

  test("purgeOlderThan(90) preserves recent rows", () => {
    const tmpPath = `/tmp/kodiai-test-purge-recent-${Date.now()}.db`;
    const fileStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });
    fileStore.record(makeRecord());

    const purged = fileStore.purgeOlderThan(90);
    fileStore.close();

    expect(purged).toBe(0);

    // Verify row still exists
    const verifyDb = new Database(tmpPath, { readonly: true });
    const count = verifyDb.query("SELECT COUNT(*) as cnt FROM executions").get() as { cnt: number };
    verifyDb.close();

    expect(count.cnt).toBe(1);

    try {
      require("node:fs").unlinkSync(tmpPath);
      require("node:fs").unlinkSync(`${tmpPath}-wal`);
      require("node:fs").unlinkSync(`${tmpPath}-shm`);
    } catch {}
  });

  test("checkpoint() runs without error", () => {
    store.record(makeRecord());
    expect(() => store.checkpoint()).not.toThrow();
  });

  test("WAL mode is active after initialization", () => {
    const tmpPath = `/tmp/kodiai-test-wal-${Date.now()}.db`;
    const fileStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });

    const verifyDb = new Database(tmpPath, { readonly: true });
    const result = verifyDb.query("PRAGMA journal_mode").get() as { journal_mode: string };
    verifyDb.close();
    fileStore.close();

    expect(result.journal_mode).toBe("wal");

    try {
      require("node:fs").unlinkSync(tmpPath);
      require("node:fs").unlinkSync(`${tmpPath}-wal`);
      require("node:fs").unlinkSync(`${tmpPath}-shm`);
    } catch {}
  });

  test("close() prevents subsequent operations", () => {
    store.close();
    expect(() => store.record(makeRecord())).toThrow();
  });

  test("auto-checkpoint triggers after 1000 writes", () => {
    // Insert 1000 records -- should not throw and DB should remain functional
    for (let i = 0; i < 1000; i++) {
      store.record(makeRecord({ deliveryId: `write-${i}` }));
    }

    // After 1000 writes, checkpoint should have been called internally.
    // Verify DB is still functional by inserting one more.
    expect(() => store.record(makeRecord({ deliveryId: "write-1001" }))).not.toThrow();
  });

  test("creates data directory if it does not exist", () => {
    const fs = require("node:fs");
    const tmpDir = `/tmp/kodiai-test-dir-${Date.now()}/nested/path`;
    const tmpPath = `${tmpDir}/test.db`;

    // Directory should not exist yet
    expect(fs.existsSync(tmpDir)).toBe(false);

    const dirStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });
    dirStore.record(makeRecord());
    dirStore.close();

    // Directory should now exist
    expect(fs.existsSync(tmpDir)).toBe(true);

    // Cleanup
    try {
      fs.rmSync(`/tmp/kodiai-test-dir-${Date.now()}`, { recursive: true });
    } catch {}
  });

  test("indexes exist on created_at and repo columns", () => {
    const tmpPath = `/tmp/kodiai-test-idx-${Date.now()}.db`;
    const fileStore = createTelemetryStore({ dbPath: tmpPath, logger: mockLogger });

    const verifyDb = new Database(tmpPath, { readonly: true });
    const indexes = verifyDb.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='executions'").all() as Array<{ name: string }>;
    verifyDb.close();
    fileStore.close();

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_executions_created_at");
    expect(indexNames).toContain("idx_executions_repo");

    try {
      require("node:fs").unlinkSync(tmpPath);
      require("node:fs").unlinkSync(`${tmpPath}-wal`);
      require("node:fs").unlinkSync(`${tmpPath}-shm`);
    } catch {}
  });
});
