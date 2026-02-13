import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import type { LearningMemoryRecord, LearningMemoryStore } from "./types.ts";

type MemoryRow = {
  id: number;
  repo: string;
  owner: string;
  finding_id: number;
  review_id: number;
  source_repo: string;
  finding_text: string;
  severity: string;
  category: string;
  file_path: string;
  outcome: string;
  embedding_model: string;
  embedding_dim: number;
  stale: number;
  created_at: string;
};

type VecResultRow = {
  memory_id: number;
  distance: number;
};

type VecVersionRow = {
  v: string;
};

function rowToRecord(row: MemoryRow): LearningMemoryRecord {
  return {
    id: row.id,
    repo: row.repo,
    owner: row.owner,
    findingId: row.finding_id,
    reviewId: row.review_id,
    sourceRepo: row.source_repo,
    findingText: row.finding_text,
    severity: row.severity as LearningMemoryRecord["severity"],
    category: row.category as LearningMemoryRecord["category"],
    filePath: row.file_path,
    outcome: row.outcome as LearningMemoryRecord["outcome"],
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    stale: row.stale === 1,
    createdAt: row.created_at,
  };
}

function createNoOpStore(logger: Logger): LearningMemoryStore {
  logger.warn("Learning memory store running in no-op mode -- all operations are disabled");
  return {
    writeMemory() {},
    retrieveMemories() {
      return [];
    },
    retrieveMemoriesForOwner() {
      return [];
    },
    getMemoryRecord() {
      return null;
    },
    markStale() {
      return 0;
    },
    purgeStaleEmbeddings() {
      return 0;
    },
    close() {},
  };
}

/**
 * Create a learning memory store backed by SQLite with sqlite-vec for vector search.
 * Uses a vec0 virtual table with repo partition key for automatic isolation.
 * Fails open to no-op store if sqlite-vec cannot load.
 */
export function createLearningMemoryStore(opts: {
  db: Database;
  logger: Logger;
}): LearningMemoryStore {
  const { db, logger } = opts;

  // Try to load sqlite-vec extension
  try {
    // Dynamic import would be better but we need synchronous load
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
  } catch (err: unknown) {
    logger.error(
      { err },
      "sqlite-vec extension failed to load, learning memory disabled (fail-open)",
    );
    return createNoOpStore(logger);
  }

  // Verify extension loaded
  try {
    const versionRow = db.prepare("SELECT vec_version() AS v").get() as VecVersionRow;
    logger.info({ vecVersion: versionRow.v }, "sqlite-vec loaded successfully");
  } catch (err: unknown) {
    logger.error({ err }, "sqlite-vec verification failed, learning memory disabled (fail-open)");
    return createNoOpStore(logger);
  }

  // Create metadata table
  db.run(`
    CREATE TABLE IF NOT EXISTS learning_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL,
      finding_id INTEGER,
      review_id INTEGER,
      source_repo TEXT NOT NULL,
      finding_text TEXT NOT NULL,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      file_path TEXT NOT NULL,
      outcome TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dim INTEGER NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, finding_id, outcome)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_memories_repo ON learning_memories(repo)");
  db.run("CREATE INDEX IF NOT EXISTS idx_memories_owner ON learning_memories(owner)");
  db.run("CREATE INDEX IF NOT EXISTS idx_memories_stale ON learning_memories(stale)");

  // Create vec0 virtual table
  // Dimension is fixed at 1024 at table creation. Changing dimensions requires table recreation.
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS learning_memory_vec USING vec0(
      memory_id INTEGER PRIMARY KEY,
      embedding float[1024],
      repo TEXT partition key,
      severity TEXT,
      category TEXT
    )
  `);

  // Prepared statements
  const insertMemoryStmt = db.prepare(`
    INSERT INTO learning_memories (
      repo, owner, finding_id, review_id, source_repo,
      finding_text, severity, category, file_path, outcome,
      embedding_model, embedding_dim, stale
    ) VALUES (
      $repo, $owner, $findingId, $reviewId, $sourceRepo,
      $findingText, $severity, $category, $filePath, $outcome,
      $embeddingModel, $embeddingDim, $stale
    )
    RETURNING id
  `);

  const insertVecStmt = db.prepare(`
    INSERT INTO learning_memory_vec (memory_id, embedding, repo, severity, category)
    VALUES ($memoryId, vec_f32($embedding), $repo, $severity, $category)
  `);

  const retrieveStmt = db.prepare(`
    SELECT v.memory_id, v.distance
    FROM learning_memory_vec v
    INNER JOIN learning_memories m ON m.id = v.memory_id
    WHERE v.embedding MATCH $queryEmbedding
      AND v.k = $topK
      AND v.repo = $repo
      AND m.stale = 0
    ORDER BY v.distance
  `);

  const getRecordStmt = db.prepare(`
    SELECT * FROM learning_memories WHERE id = $memoryId
  `);

  const markStaleStmt = db.prepare(`
    UPDATE learning_memories SET stale = 1
    WHERE embedding_model != $embeddingModel AND stale = 0
  `);

  const deleteStaleVecStmt = db.prepare(`
    DELETE FROM learning_memory_vec
    WHERE memory_id IN (SELECT id FROM learning_memories WHERE stale = 1)
  `);

  const deleteStaleMemoriesStmt = db.prepare(`
    DELETE FROM learning_memories WHERE stale = 1
  `);

  // For owner-level sharing: find distinct repos for same owner
  const ownerReposStmt = db.prepare(`
    SELECT repo, COUNT(*) AS cnt
    FROM learning_memories
    WHERE owner = $owner AND repo != $excludeRepo AND stale = 0
    GROUP BY repo
    ORDER BY cnt DESC
    LIMIT 5
  `);

  const writeMemoryTxn = db.transaction(
    (record: LearningMemoryRecord, embedding: Float32Array) => {
      const result = insertMemoryStmt.get({
        $repo: record.repo,
        $owner: record.owner,
        $findingId: record.findingId,
        $reviewId: record.reviewId,
        $sourceRepo: record.sourceRepo,
        $findingText: record.findingText,
        $severity: record.severity,
        $category: record.category,
        $filePath: record.filePath,
        $outcome: record.outcome,
        $embeddingModel: record.embeddingModel,
        $embeddingDim: record.embeddingDim,
        $stale: record.stale ? 1 : 0,
      }) as { id: number };

      insertVecStmt.run({
        $memoryId: result.id,
        $embedding: embedding,
        $repo: record.repo,
        $severity: record.severity,
        $category: record.category,
      });

      return result.id;
    },
  );

  const purgeTransaction = db.transaction(() => {
    deleteStaleVecStmt.run();
    const result = deleteStaleMemoriesStmt.run();
    return result.changes;
  });

  const store: LearningMemoryStore = {
    writeMemory(record: LearningMemoryRecord, embedding: Float32Array): void {
      try {
        writeMemoryTxn(record, embedding);
      } catch (err: unknown) {
        // Fail-open: log but don't throw for UNIQUE constraint violations (duplicate writes)
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("UNIQUE constraint failed")) {
          logger.debug({ repo: record.repo, findingId: record.findingId }, "Duplicate memory write skipped");
          return;
        }
        throw err;
      }
    },

    retrieveMemories(params: {
      queryEmbedding: Float32Array;
      repo: string;
      topK: number;
    }): { memoryId: number; distance: number }[] {
      const rows = retrieveStmt.all({
        $queryEmbedding: params.queryEmbedding,
        $topK: params.topK,
        $repo: params.repo,
      }) as VecResultRow[];

      return rows.map((row) => ({
        memoryId: row.memory_id,
        distance: row.distance,
      }));
    },

    retrieveMemoriesForOwner(params: {
      queryEmbedding: Float32Array;
      owner: string;
      excludeRepo: string;
      topK: number;
    }): { memoryId: number; distance: number }[] {
      // Find repos for the same owner (up to 5 most active)
      const repoRows = ownerReposStmt.all({
        $owner: params.owner,
        $excludeRepo: params.excludeRepo,
      }) as { repo: string; cnt: number }[];

      if (repoRows.length === 0) {
        return [];
      }

      // Query each repo partition and merge results
      const allResults: { memoryId: number; distance: number }[] = [];
      const perRepoK = Math.max(1, Math.ceil(params.topK / repoRows.length));

      for (const repoRow of repoRows) {
        try {
          const rows = retrieveStmt.all({
            $queryEmbedding: params.queryEmbedding,
            $topK: perRepoK,
            $repo: repoRow.repo,
          }) as VecResultRow[];

          for (const row of rows) {
            allResults.push({
              memoryId: row.memory_id,
              distance: row.distance,
            });
          }
        } catch (err: unknown) {
          logger.debug(
            { err, repo: repoRow.repo },
            "Failed to retrieve memories from shared repo partition (fail-open)",
          );
        }
      }

      // Dedupe by memory_id, sort by distance, take topK
      const seen = new Set<number>();
      const deduped = allResults.filter((r) => {
        if (seen.has(r.memoryId)) return false;
        seen.add(r.memoryId);
        return true;
      });

      deduped.sort((a, b) => a.distance - b.distance);
      return deduped.slice(0, params.topK);
    },

    getMemoryRecord(memoryId: number): LearningMemoryRecord | null {
      const row = getRecordStmt.get({ $memoryId: memoryId }) as MemoryRow | null;
      if (!row) return null;
      return rowToRecord(row);
    },

    markStale(embeddingModel: string): number {
      const result = markStaleStmt.run({ $embeddingModel: embeddingModel });
      return result.changes;
    },

    purgeStaleEmbeddings(): number {
      return purgeTransaction();
    },

    close(): void {
      // No-op: db lifecycle managed by caller
    },
  };

  logger.debug("LearningMemoryStore initialized with vec0 virtual table");
  return store;
}
