import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { createIsolationLayer } from "./isolation.ts";
import type { LearningMemoryRecord, LearningMemoryStore } from "./types.ts";

function createMockLogger(): Logger {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: "silent",
  } as unknown as Logger;

  return logger;
}

type Candidate = { memoryId: number; distance: number };

type StoreState = {
  repoResults?: Candidate[];
  ownerResults?: Candidate[];
  records?: Record<number, LearningMemoryRecord | null>;
  singleReadIds?: number[];
  batchReadIds?: number[][];
};

function makeRecord(memoryId: number, sourceRepo: string): LearningMemoryRecord {
  return {
    id: memoryId,
    repo: sourceRepo,
    owner: sourceRepo.split("/")[0] ?? "owner",
    findingId: memoryId,
    reviewId: memoryId + 100,
    sourceRepo,
    findingText: `finding-${memoryId}`,
    severity: "major",
    category: "correctness",
    filePath: `src/file-${memoryId}.ts`,
    outcome: "accepted",
    embeddingModel: "test-model",
    embeddingDim: 3,
    stale: false,
    createdAt: "2025-01-01T00:00:00Z",
  };
}

function createStore(state: StoreState = {}): LearningMemoryStore {
  const records = state.records ?? {};

  const store: LearningMemoryStore = {
    async hasMemoryConflict() {
      return false;
    },
    async writeMemory() {},
    async retrieveMemories() {
      return state.repoResults ?? [];
    },
    async retrieveMemoriesForOwner() {
      return state.ownerResults ?? [];
    },
    async getMemoryRecord(memoryId: number) {
      state.singleReadIds?.push(memoryId);
      return records[memoryId] ?? null;
    },
    async getMemoryRecords(memoryIds: number[]) {
      state.batchReadIds?.push([...memoryIds]);
      const result = new Map<number, LearningMemoryRecord>();
      for (const memoryId of memoryIds) {
        const record = records[memoryId] ?? null;
        if (record) result.set(memoryId, record);
      }
      return result;
    },
    async markStale() {
      return 0;
    },
    async purgeStaleEmbeddings() {
      return 0;
    },
    close() {},
  };

  return store;
}

describe("createIsolationLayer", () => {
  test("non-adaptive mode filters over-threshold repo and shared results", async () => {
    const layer = createIsolationLayer({
      memoryStore: createStore({
        repoResults: [
          { memoryId: 1, distance: 0.2 },
          { memoryId: 2, distance: 0.8 },
        ],
        ownerResults: [
          { memoryId: 3, distance: 0.4 },
          { memoryId: 4, distance: 0.9 },
        ],
        records: {
          1: makeRecord(1, "owner/repo"),
          3: makeRecord(3, "owner/shared"),
        },
      }),
      logger: createMockLogger(),
    });

    const result = await layer.retrieveWithIsolation({
      queryEmbedding: new Float32Array([0.1, 0.2]),
      repo: "owner/repo",
      owner: "owner",
      sharingEnabled: true,
      topK: 5,
      distanceThreshold: 0.5,
      adaptive: false,
      logger: createMockLogger(),
    });

    expect(result.results.map((entry) => entry.memoryId)).toEqual([1, 3]);
    expect(result.results.map((entry) => entry.distance)).toEqual([0.2, 0.4]);
    expect(result.provenance.totalCandidates).toBe(2);
    expect(result.provenance.sharedPoolUsed).toBe(true);
    expect(result.provenance.query.internalTopK).toBe(5);
  });

  test("adaptive mode expands internal topK and preserves over-threshold candidates", async () => {
    const layer = createIsolationLayer({
      memoryStore: createStore({
        repoResults: [
          { memoryId: 1, distance: 0.2 },
          { memoryId: 2, distance: 0.95 },
        ],
        records: {
          1: makeRecord(1, "owner/repo"),
          2: makeRecord(2, "owner/repo"),
        },
      }),
      logger: createMockLogger(),
    });

    const result = await layer.retrieveWithIsolation({
      queryEmbedding: new Float32Array([0.1]),
      repo: "owner/repo",
      owner: "owner",
      sharingEnabled: false,
      topK: 3,
      distanceThreshold: 0.3,
      adaptive: true,
      logger: createMockLogger(),
    });

    expect(result.results.map((entry) => entry.memoryId)).toEqual([1, 2]);
    expect(result.results[1]?.distance).toBe(0.95);
    expect(result.provenance.query.internalTopK).toBe(20);
    expect(result.provenance.sharedPoolUsed).toBe(false);
  });

  test("dedupes shared-pool collisions by first-seen closest candidate and keeps truthful provenance when sharing is disabled", async () => {
    const layer = createIsolationLayer({
      memoryStore: createStore({
        repoResults: [
          { memoryId: 10, distance: 0.15 },
          { memoryId: 11, distance: 0.4 },
        ],
        ownerResults: [
          { memoryId: 10, distance: 0.8 },
          { memoryId: 12, distance: 0.3 },
        ],
        records: {
          10: makeRecord(10, "owner/repo"),
          11: makeRecord(11, "owner/repo"),
          12: makeRecord(12, "owner/other-repo"),
        },
      }),
      logger: createMockLogger(),
    });

    const sharedEnabled = await layer.retrieveWithIsolation({
      queryEmbedding: new Float32Array([0.1]),
      repo: "owner/repo",
      owner: "owner",
      sharingEnabled: true,
      topK: 3,
      distanceThreshold: 1,
      adaptive: false,
      logger: createMockLogger(),
    });

    expect(sharedEnabled.results.map((entry) => ({ id: entry.memoryId, distance: entry.distance }))).toEqual([
      { id: 10, distance: 0.15 },
      { id: 12, distance: 0.3 },
      { id: 11, distance: 0.4 },
    ]);
    expect(sharedEnabled.provenance.repoSources.sort()).toEqual(["owner/other-repo", "owner/repo"]);
    expect(sharedEnabled.provenance.sharedPoolUsed).toBe(true);
    expect(sharedEnabled.provenance.totalCandidates).toBe(4);

    const sharingDisabled = await layer.retrieveWithIsolation({
      queryEmbedding: new Float32Array([0.1]),
      repo: "owner/repo",
      owner: "owner",
      sharingEnabled: false,
      topK: 3,
      distanceThreshold: 1,
      adaptive: false,
      logger: createMockLogger(),
    });

    expect(sharingDisabled.results.map((entry) => entry.memoryId)).toEqual([10, 11]);
    expect(sharingDisabled.provenance.repoSources).toEqual(["owner/repo"]);
    expect(sharingDisabled.provenance.sharedPoolUsed).toBe(false);
    expect(sharingDisabled.provenance.totalCandidates).toBe(2);
  });

  test("hydrates selected memories in one batch", async () => {
    const singleReadIds: number[] = [];
    const batchReadIds: number[][] = [];
    const layer = createIsolationLayer({
      memoryStore: createStore({
        singleReadIds,
        batchReadIds,
        repoResults: [
          { memoryId: 1, distance: 0.1 },
          { memoryId: 2, distance: 0.2 },
          { memoryId: 3, distance: 0.3 },
        ],
        records: {
          1: makeRecord(1, "owner/repo"),
          2: makeRecord(2, "owner/repo"),
          3: makeRecord(3, "owner/repo"),
        },
      }),
      logger: createMockLogger(),
    });

    const result = await layer.retrieveWithIsolation({
      queryEmbedding: new Float32Array([0.1]),
      repo: "owner/repo",
      owner: "owner",
      sharingEnabled: false,
      topK: 3,
      distanceThreshold: 1,
      adaptive: false,
      logger: createMockLogger(),
    });

    expect(result.results.map((entry) => entry.memoryId)).toEqual([1, 2, 3]);
    expect(batchReadIds).toEqual([[1, 2, 3]]);
    expect(singleReadIds).toEqual([]);
  });
});
