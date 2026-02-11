import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { TelemetryRecord, TelemetryStore } from "./types.ts";

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

  // Indexes for retention purge queries and repo-based reporting
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_executions_created_at
    ON executions(created_at)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_executions_repo
    ON executions(repo)
  `);

  // Prepared insert statement (cached for performance)
  const insertStmt = db.query(`
    INSERT INTO executions (
      delivery_id, repo, pr_number, event_type, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason
    ) VALUES (
      $deliveryId, $repo, $prNumber, $eventType, $provider, $model,
      $inputTokens, $outputTokens, $cacheReadTokens, $cacheCreationTokens,
      $durationMs, $costUsd, $conclusion, $sessionId, $numTurns, $stopReason
    )
  `);

  let writeCount = 0;

  const store: TelemetryStore = {
    record(entry: TelemetryRecord): void {
      insertStmt.run({
        $deliveryId: entry.deliveryId ?? null,
        $repo: entry.repo,
        $prNumber: entry.prNumber ?? null,
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

      writeCount++;
      if (writeCount >= 1000) {
        store.checkpoint();
        writeCount = 0;
      }
    },

    purgeOlderThan(days: number): number {
      const purgeStmt = db.query(
        "DELETE FROM executions WHERE created_at < datetime('now', $modifier) RETURNING id",
      );
      const deleted = purgeStmt.all({ $modifier: `-${days} days` });
      return deleted.length;
    },

    checkpoint(): void {
      db.run("PRAGMA wal_checkpoint(PASSIVE)");
    },

    close(): void {
      db.close(false);
    },
  };

  logger.debug({ dbPath }, "TelemetryStore initialized");
  return store;
}
