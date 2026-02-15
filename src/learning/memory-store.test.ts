import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLearningMemoryStore } from "./memory-store.ts";
import type { LearningMemoryStore, LearningMemoryRecord } from "./types.ts";

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

function makeRecord(overrides: Partial<LearningMemoryRecord> = {}): LearningMemoryRecord {
  return {
    repo: "owner/repo-a",
    owner: "owner",
    findingId: 1001,
    reviewId: 1,
    sourceRepo: "owner/repo-a",
    findingText: "Potential null pointer dereference",
    severity: "major",
    category: "correctness",
    filePath: "src/utils.ts",
    outcome: "accepted",
    embeddingModel: "voyage-code-3",
    embeddingDim: 1024,
    stale: false,
    ...overrides,
  };
}

function makeEmbedding(seed: number = 42): Float32Array {
  const arr = new Float32Array(1024);
  // Simple deterministic pseudo-random fill
  let val = seed;
  for (let i = 0; i < 1024; i++) {
    val = ((val * 1664525 + 1013904223) & 0xffffffff) >>> 0;
    arr[i] = (val / 0xffffffff) * 2 - 1;
  }
  // Normalize to unit vector (required for meaningful distance computations)
  let norm = 0;
  for (let i = 0; i < 1024; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1024; i++) arr[i] /= norm;
  return arr;
}

describe("LearningMemoryStore", () => {
  let db: Database;
  let store: LearningMemoryStore;
  let tmpDir: string;
  let isNoOp: boolean;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kodiai-memory-test-"));
    const dbPath = join(tmpDir, "test.db");
    db = new Database(dbPath, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA busy_timeout = 5000");

    store = createLearningMemoryStore({ db, logger: mockLogger });

    // Check if sqlite-vec is available
    isNoOp = false;
    try {
      db.prepare("SELECT vec_version()").get();
    } catch {
      isNoOp = true;
    }
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // ignore
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("creates tables on initialization", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='shadow'")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("learning_memories");
    // vec0 virtual tables create shadow tables; check for the virtual table via sqlite_master type='table'
    const allEntries = db
      .prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'learning_memory_vec%'")
      .all() as { name: string; type: string }[];
    expect(allEntries.length).toBeGreaterThan(0);
  });

  test("writeMemory stores record and embedding", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const record = makeRecord();
    const embedding = makeEmbedding(42);

    store.writeMemory(record, embedding);

    // Verify record stored
    const stored = store.getMemoryRecord(1);
    expect(stored).not.toBeNull();
    expect(stored!.repo).toBe("owner/repo-a");
    expect(stored!.owner).toBe("owner");
    expect(stored!.findingId).toBe(1001);
    expect(stored!.reviewId).toBe(1);
    expect(stored!.findingText).toBe("Potential null pointer dereference");
    expect(stored!.severity).toBe("major");
    expect(stored!.category).toBe("correctness");
    expect(stored!.filePath).toBe("src/utils.ts");
    expect(stored!.outcome).toBe("accepted");
    expect(stored!.embeddingModel).toBe("voyage-code-3");
    expect(stored!.embeddingDim).toBe(1024);
    expect(stored!.stale).toBe(false);
  });

  test("retrieveMemories returns similar vectors for same repo", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const embedding1 = makeEmbedding(100);
    const embedding2 = makeEmbedding(101);

    store.writeMemory(
      makeRecord({ findingId: 2001, findingText: "Finding A" }),
      embedding1,
    );
    store.writeMemory(
      makeRecord({ findingId: 2002, findingText: "Finding B" }),
      embedding2,
    );

    // Query with embedding1 -- should return both, sorted by distance
    const results = store.retrieveMemories({
      queryEmbedding: embedding1,
      repo: "owner/repo-a",
      topK: 10,
    });

    expect(results.length).toBe(2);
    // First result should be the exact match (distance ~0)
    expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
  });

  test("retrieveMemories enforces repo isolation", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const embedding = makeEmbedding(200);

    // Write to repo-a
    store.writeMemory(
      makeRecord({ repo: "owner/repo-a", sourceRepo: "owner/repo-a", findingId: 3001 }),
      embedding,
    );

    // Query for repo-b with same embedding -- should return empty
    const results = store.retrieveMemories({
      queryEmbedding: embedding,
      repo: "owner/repo-b",
      topK: 10,
    });

    expect(results.length).toBe(0);

    // Query for repo-a -- should find the record
    const repoAResults = store.retrieveMemories({
      queryEmbedding: embedding,
      repo: "owner/repo-a",
      topK: 10,
    });

    expect(repoAResults.length).toBe(1);
  });

  test("writeMemory enforces UNIQUE constraint on (repo, finding_id, outcome)", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const embedding = makeEmbedding(300);
    const record = makeRecord({ findingId: 4001, outcome: "accepted" });

    // First write should succeed
    store.writeMemory(record, embedding);

    // Second write with same (repo, findingId, outcome) should be silently skipped
    store.writeMemory(record, embedding);

    // Verify only one record exists
    const row = db
      .prepare("SELECT COUNT(*) as cnt FROM learning_memories WHERE finding_id = 4001")
      .get() as { cnt: number };
    expect(row.cnt).toBe(1);
  });

  test("markStale marks old model embeddings", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const embedding1 = makeEmbedding(400);
    const embedding2 = makeEmbedding(401);

    // Write with old model
    store.writeMemory(
      makeRecord({
        findingId: 5001,
        embeddingModel: "voyage-code-2",
      }),
      embedding1,
    );

    // Write with current model
    store.writeMemory(
      makeRecord({
        findingId: 5002,
        embeddingModel: "voyage-code-3",
      }),
      embedding2,
    );

    // Mark stale: anything not matching "voyage-code-3"
    const staleCount = store.markStale("voyage-code-3");
    expect(staleCount).toBe(1);

    // Verify: old model record is stale
    const oldRecord = store.getMemoryRecord(1);
    expect(oldRecord).not.toBeNull();
    expect(oldRecord!.stale).toBe(true);

    // Verify: current model record is not stale
    const currentRecord = store.getMemoryRecord(2);
    expect(currentRecord).not.toBeNull();
    expect(currentRecord!.stale).toBe(false);
  });

  test("purgeStaleEmbeddings removes stale records from both tables", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const embedding = makeEmbedding(500);

    store.writeMemory(
      makeRecord({
        findingId: 6001,
        embeddingModel: "voyage-code-2",
      }),
      embedding,
    );

    // Verify record exists
    expect(store.getMemoryRecord(1)).not.toBeNull();

    // Mark stale and purge
    store.markStale("voyage-code-3");
    const purged = store.purgeStaleEmbeddings();
    expect(purged).toBe(1);

    // Record should be gone from learning_memories
    expect(store.getMemoryRecord(1)).toBeNull();

    // Vec table should also be empty
    const vecCount = db
      .prepare("SELECT COUNT(*) as cnt FROM learning_memory_vec")
      .get() as { cnt: number };
    expect(vecCount.cnt).toBe(0);
  });

  test("getMemoryRecord returns null for non-existent id", () => {
    if (isNoOp) {
      console.log("SKIP: sqlite-vec not available in test environment");
      return;
    }

    const result = store.getMemoryRecord(99999);
    expect(result).toBeNull();
  });
});
