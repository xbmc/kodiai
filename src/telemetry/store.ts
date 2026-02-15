import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type {
  RetrievalQualityRecord,
  TelemetryRecord,
  TelemetryStore,
} from "./types.ts";

/**
 * Create a TelemetryStore backed by SQLite.
 *
 * Uses WAL mode for concurrent read/write, prepared statements for inserts,
 * and auto-checkpoints every 1000 writes. Follows the existing factory
 * function DI pattern (same as createJobQueue, createWorkspaceManager, etc.).
 */
export function createTelemetryStore(opts: {
  dbPath: string;
  logger: Logger;
}): TelemetryStore {
  const { dbPath, logger } = opts;

  // Ensure parent directory exists (SQLite creates file, not directory)
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { create: true });

  // PRAGMAs: WAL mode, NORMAL sync (safe with WAL), busy timeout for concurrent access
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");

  // Create executions table
  db.run(`
    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivery_id TEXT,
      repo TEXT NOT NULL,
      pr_number INTEGER,
      pr_author TEXT,
      event_type TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      conclusion TEXT NOT NULL,
      session_id TEXT,
      num_turns INTEGER,
      stop_reason TEXT
    )
  `);

  // Additive column migration for older telemetry DBs
  try {
    db.run("ALTER TABLE executions ADD COLUMN pr_author TEXT");
  } catch {
    // Column already exists -- safe to ignore
  }

  // Create retrieval_quality table (additive-only migration)
  db.run(`
    CREATE TABLE IF NOT EXISTS retrieval_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivery_id TEXT,
      repo TEXT NOT NULL,
      pr_number INTEGER,
      event_type TEXT NOT NULL,
      top_k INTEGER,
      distance_threshold REAL,
      result_count INTEGER NOT NULL,
      avg_distance REAL,
      language_match_ratio REAL,
      threshold_method TEXT
    )
  `);

  // Additive column migration for older telemetry DBs
  const rqTableInfo = db.prepare("PRAGMA table_info(retrieval_quality)").all() as {
    name: string;
  }[];
  if (!rqTableInfo.some((c) => c.name === "threshold_method")) {
    db.run("ALTER TABLE retrieval_quality ADD COLUMN threshold_method TEXT");
  }

  // Indexes for retention purge queries and repo-based reporting
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_executions_created_at
    ON executions(created_at)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_executions_repo
    ON executions(repo)
  `);

  // Indexes for retrieval quality lookups and webhook redelivery idempotency
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_retrieval_quality_delivery
    ON retrieval_quality(delivery_id)
    WHERE delivery_id IS NOT NULL
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_retrieval_quality_repo_created
    ON retrieval_quality(repo, created_at)
  `);

  // Prepared insert statement (cached for performance)
  const insertStmt = db.query(`
    INSERT INTO executions (
      delivery_id, repo, pr_number, pr_author, event_type, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason
    ) VALUES (
      $deliveryId, $repo, $prNumber, $prAuthor, $eventType, $provider, $model,
      $inputTokens, $outputTokens, $cacheReadTokens, $cacheCreationTokens,
      $durationMs, $costUsd, $conclusion, $sessionId, $numTurns, $stopReason
    )
  `);

  const insertRetrievalQualityStmt = db.query(`
    INSERT OR IGNORE INTO retrieval_quality (
      delivery_id, repo, pr_number, event_type,
      top_k, distance_threshold, result_count, avg_distance, language_match_ratio,
      threshold_method
    ) VALUES (
      $deliveryId, $repo, $prNumber, $eventType,
      $topK, $distanceThreshold, $resultCount, $avgDistance, $languageMatchRatio,
      $thresholdMethod
    )
  `);

  let writeCount = 0;

  const runCheckpoint = (): void => {
    db.run("PRAGMA wal_checkpoint(PASSIVE)");
  };

  const bumpWriteCount = (): void => {
    writeCount++;
    if (writeCount >= 1000) {
      runCheckpoint();
      writeCount = 0;
    }
  };

  const store: TelemetryStore = {
    record(entry: TelemetryRecord): void {
      insertStmt.run({
        $deliveryId: entry.deliveryId ?? null,
        $repo: entry.repo,
        $prNumber: entry.prNumber ?? null,
        $prAuthor: entry.prAuthor ?? null,
        $eventType: entry.eventType,
        $provider: entry.provider ?? "anthropic",
        $model: entry.model,
        $inputTokens: entry.inputTokens ?? 0,
        $outputTokens: entry.outputTokens ?? 0,
        $cacheReadTokens: entry.cacheReadTokens ?? 0,
        $cacheCreationTokens: entry.cacheCreationTokens ?? 0,
        $durationMs: entry.durationMs ?? 0,
        $costUsd: entry.costUsd ?? 0,
        $conclusion: entry.conclusion,
        $sessionId: entry.sessionId ?? null,
        $numTurns: entry.numTurns ?? null,
        $stopReason: entry.stopReason ?? null,
      });

      bumpWriteCount();
    },

    countRecentTimeouts(repo: string, author: string): number {
      const row = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM executions
           WHERE repo = ? AND pr_author = ?
           AND conclusion IN ('timeout', 'timeout_partial')
           AND created_at > datetime('now', '-7 days')`,
        )
        .get(repo, author) as { cnt: number } | null;
      return row?.cnt ?? 0;
    },

    recordRetrievalQuality(entry: RetrievalQualityRecord): void {
      insertRetrievalQualityStmt.run({
        $deliveryId: entry.deliveryId ?? null,
        $repo: entry.repo,
        $prNumber: entry.prNumber ?? null,
        $eventType: entry.eventType,
        $topK: entry.topK ?? null,
        $distanceThreshold: entry.distanceThreshold ?? null,
        $resultCount: entry.resultCount,
        $avgDistance: entry.avgDistance ?? null,
        $languageMatchRatio: entry.languageMatchRatio ?? null,
        $thresholdMethod: entry.thresholdMethod ?? null,
      });

      bumpWriteCount();
    },

    purgeOlderThan(days: number): number {
      const purgeStmt = db.query(
        "DELETE FROM executions WHERE created_at < datetime('now', $modifier) RETURNING id",
      );
      const deleted = purgeStmt.all({ $modifier: `-${days} days` });
      return deleted.length;
    },

    checkpoint(): void {
      runCheckpoint();
    },

    close(): void {
      db.close(false);
    },
  };

  logger.debug({ dbPath }, "TelemetryStore initialized");
  return store;
}
