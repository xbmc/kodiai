import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createLearningMemoryStore } from "./memory-store.ts";
import { createDbClient, type Sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
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
  for (let i = 0; i < 1024; i++) norm += arr[i]! * arr[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1024; i++) arr[i] = arr[i]! / norm;
  return arr;
}

describe("LearningMemoryStore (pgvector)", () => {
  let sql: Sql;
  let store: LearningMemoryStore;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    const client = createDbClient({
      connectionString: "postgresql://kodiai:kodiai@localhost:5432/kodiai",
      logger: mockLogger,
    });
    sql = client.sql;
    closeDb = client.close;

    // Ensure migrations are applied
    await runMigrations(sql);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    // Clean learning_memories table between tests
    await sql`DELETE FROM learning_memories`;

    store = createLearningMemoryStore({ sql, logger: mockLogger });
  });

  test("writeMemory stores record and embedding", async () => {
    const record = makeRecord();
    const embedding = makeEmbedding(42);

    await store.writeMemory(record, embedding);

    // Verify record stored via direct SQL
    const rows = await sql`SELECT * FROM learning_memories WHERE finding_id = 1001`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.repo).toBe("owner/repo-a");
    expect(rows[0]!.owner).toBe("owner");
    expect(rows[0]!.severity).toBe("major");
    expect(rows[0]!.embedding).not.toBeNull();
  });

  test("writeMemory stores record and getMemoryRecord retrieves it", async () => {
    const record = makeRecord();
    const embedding = makeEmbedding(42);

    await store.writeMemory(record, embedding);

    // Get the inserted ID
    const rows = await sql`SELECT id FROM learning_memories WHERE finding_id = 1001`;
    const id = rows[0]!.id;

    const stored = await store.getMemoryRecord(id);
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

  test("retrieveMemories returns similar vectors for same repo", async () => {
    const embedding1 = makeEmbedding(100);
    const embedding2 = makeEmbedding(101);

    await store.writeMemory(
      makeRecord({ findingId: 2001, findingText: "Finding A" }),
      embedding1,
    );
    await store.writeMemory(
      makeRecord({ findingId: 2002, findingText: "Finding B" }),
      embedding2,
    );

    // Query with embedding1 -- should return both, sorted by distance
    const results = await store.retrieveMemories({
      queryEmbedding: embedding1,
      repo: "owner/repo-a",
      topK: 10,
    });

    expect(results.length).toBe(2);
    // First result should be the exact match (distance ~0)
    expect(results[0]!.distance).toBeLessThanOrEqual(results[1]!.distance);
    // The exact match should have near-zero distance
    expect(results[0]!.distance).toBeLessThan(0.01);
  });

  test("retrieveMemories enforces repo isolation", async () => {
    const embedding = makeEmbedding(200);

    // Write to repo-a
    await store.writeMemory(
      makeRecord({ repo: "owner/repo-a", sourceRepo: "owner/repo-a", findingId: 3001 }),
      embedding,
    );

    // Query for repo-b with same embedding -- should return empty
    const results = await store.retrieveMemories({
      queryEmbedding: embedding,
      repo: "owner/repo-b",
      topK: 10,
    });

    expect(results.length).toBe(0);

    // Query for repo-a -- should find the record
    const repoAResults = await store.retrieveMemories({
      queryEmbedding: embedding,
      repo: "owner/repo-a",
      topK: 10,
    });

    expect(repoAResults.length).toBe(1);
  });

  test("writeMemory duplicate is silently ignored (ON CONFLICT DO NOTHING)", async () => {
    const embedding = makeEmbedding(300);
    const record = makeRecord({ findingId: 4001, outcome: "accepted" });

    // First write should succeed
    await store.writeMemory(record, embedding);

    // Second write with same (repo, findingId, outcome) should be silently ignored
    await store.writeMemory(record, embedding);

    // Verify only one record exists
    const rows = await sql`SELECT COUNT(*)::int AS cnt FROM learning_memories WHERE finding_id = 4001`;
    expect(rows[0]!.cnt).toBe(1);
  });

  test("markStale marks old model embeddings", async () => {
    const embedding1 = makeEmbedding(400);
    const embedding2 = makeEmbedding(401);

    // Write with old model
    await store.writeMemory(
      makeRecord({
        findingId: 5001,
        embeddingModel: "voyage-code-2",
      }),
      embedding1,
    );

    // Write with current model
    await store.writeMemory(
      makeRecord({
        findingId: 5002,
        embeddingModel: "voyage-code-3",
      }),
      embedding2,
    );

    // Mark stale: anything not matching "voyage-code-3"
    const staleCount = await store.markStale("voyage-code-3");
    expect(staleCount).toBe(1);

    // Verify: old model record is stale
    const rows = await sql`SELECT id, stale FROM learning_memories ORDER BY finding_id`;
    expect(rows[0]!.stale).toBe(true);
    expect(rows[1]!.stale).toBe(false);
  });

  test("purgeStaleEmbeddings removes stale records", async () => {
    const embedding = makeEmbedding(500);

    await store.writeMemory(
      makeRecord({
        findingId: 6001,
        embeddingModel: "voyage-code-2",
      }),
      embedding,
    );

    // Verify record exists
    const rowsBefore = await sql`SELECT COUNT(*)::int AS cnt FROM learning_memories`;
    expect(rowsBefore[0]!.cnt).toBe(1);

    // Mark stale and purge
    await store.markStale("voyage-code-3");
    const purged = await store.purgeStaleEmbeddings();
    expect(purged).toBe(1);

    // Record should be gone
    const rowsAfter = await sql`SELECT COUNT(*)::int AS cnt FROM learning_memories`;
    expect(rowsAfter[0]!.cnt).toBe(0);
  });

  test("getMemoryRecord returns null for non-existent id", async () => {
    const result = await store.getMemoryRecord(99999);
    expect(result).toBeNull();
  });

  test("retrieveMemoriesForOwner works cross-repo", async () => {
    const embedding = makeEmbedding(600);
    const similarEmbedding = makeEmbedding(601);

    // Write to repo-b under same owner
    await store.writeMemory(
      makeRecord({
        repo: "owner/repo-b",
        sourceRepo: "owner/repo-b",
        findingId: 7001,
        owner: "owner",
      }),
      embedding,
    );

    // Write to repo-c under same owner
    await store.writeMemory(
      makeRecord({
        repo: "owner/repo-c",
        sourceRepo: "owner/repo-c",
        findingId: 7002,
        owner: "owner",
      }),
      similarEmbedding,
    );

    // Query for owner, excluding repo-a
    const results = await store.retrieveMemoriesForOwner({
      queryEmbedding: embedding,
      owner: "owner",
      excludeRepo: "owner/repo-a",
      topK: 10,
    });

    expect(results.length).toBe(2);
    // Results should be sorted by distance
    expect(results[0]!.distance).toBeLessThanOrEqual(results[1]!.distance);
  });

  test("vector similarity search returns results ordered by cosine distance", async () => {
    // Create 3 distinct embeddings with known similarity relationships
    const base = makeEmbedding(700);
    const similar = new Float32Array(1024);
    const different = new Float32Array(1024);

    // Similar: add small noise to base
    for (let i = 0; i < 1024; i++) {
      similar[i] = base[i]! + (i % 10 === 0 ? 0.01 : 0);
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < 1024; i++) norm += similar[i]! * similar[i]!;
    norm = Math.sqrt(norm);
    for (let i = 0; i < 1024; i++) similar[i] = similar[i]! / norm;

    // Different: use a very different seed
    const diff = makeEmbedding(999);
    for (let i = 0; i < 1024; i++) different[i] = diff[i]!;

    await store.writeMemory(makeRecord({ findingId: 8001, findingText: "Base" }), base);
    await store.writeMemory(makeRecord({ findingId: 8002, findingText: "Similar" }), similar);
    await store.writeMemory(makeRecord({ findingId: 8003, findingText: "Different" }), different);

    const results = await store.retrieveMemories({
      queryEmbedding: base,
      repo: "owner/repo-a",
      topK: 3,
    });

    expect(results.length).toBe(3);
    // Exact match should be first with near-zero distance
    expect(results[0]!.distance).toBeLessThan(0.01);
    // Similar should be closer than different
    expect(results[1]!.distance).toBeLessThan(results[2]!.distance);
  });
});
