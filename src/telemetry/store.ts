import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type {
  RateLimitEventRecord,
  RetrievalQualityRecord,
  ResilienceEventRecord,
  TelemetryRecord,
  TelemetryStore,
} from "./types.ts";

type TableInfoRow = { name: string };

function hasTableColumn(db: Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
  return rows.some((r) => r.name === columnName);
}

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

  // Create resilience_events table for checkpoint/retry metadata
  db.run(`
    CREATE TABLE IF NOT EXISTS resilience_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivery_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER,
      pr_author TEXT,
      event_type TEXT NOT NULL,
      kind TEXT NOT NULL,
      parent_delivery_id TEXT,
      review_output_key TEXT,

      execution_conclusion TEXT,
      had_inline_output INTEGER,

      checkpoint_files_reviewed INTEGER,
      checkpoint_finding_count INTEGER,
      checkpoint_total_files INTEGER,
      partial_comment_id INTEGER,

      recent_timeouts INTEGER,
      chronic_timeout INTEGER,

      retry_enqueued INTEGER,
      retry_files_count INTEGER,
      retry_scope_ratio REAL,
      retry_timeout_seconds INTEGER,
      retry_risk_level TEXT,
      retry_checkpoint_enabled INTEGER,
      retry_has_results INTEGER
    )
  `);

  // Create rate_limit_events table for Search rate-limit observability
  db.run(`
    CREATE TABLE IF NOT EXISTS rate_limit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivery_id TEXT,
      repo TEXT NOT NULL,
      pr_number INTEGER,
      event_type TEXT NOT NULL,
      cache_hit_rate REAL NOT NULL,
      skipped_queries INTEGER NOT NULL,
      retry_attempts INTEGER NOT NULL,
      degradation_path TEXT NOT NULL
    )
  `);

  // Ensure additive columns exist for older DBs
  const resilienceColumns: Array<{ name: string; definition: string }> = [
    { name: "pr_author", definition: "pr_author TEXT" },
    { name: "parent_delivery_id", definition: "parent_delivery_id TEXT" },
    { name: "review_output_key", definition: "review_output_key TEXT" },
    { name: "execution_conclusion", definition: "execution_conclusion TEXT" },
    { name: "had_inline_output", definition: "had_inline_output INTEGER" },
    { name: "checkpoint_files_reviewed", definition: "checkpoint_files_reviewed INTEGER" },
    { name: "checkpoint_finding_count", definition: "checkpoint_finding_count INTEGER" },
    { name: "checkpoint_total_files", definition: "checkpoint_total_files INTEGER" },
    { name: "partial_comment_id", definition: "partial_comment_id INTEGER" },
    { name: "recent_timeouts", definition: "recent_timeouts INTEGER" },
    { name: "chronic_timeout", definition: "chronic_timeout INTEGER" },
    { name: "retry_enqueued", definition: "retry_enqueued INTEGER" },
    { name: "retry_files_count", definition: "retry_files_count INTEGER" },
    { name: "retry_scope_ratio", definition: "retry_scope_ratio REAL" },
    { name: "retry_timeout_seconds", definition: "retry_timeout_seconds INTEGER" },
    { name: "retry_risk_level", definition: "retry_risk_level TEXT" },
    { name: "retry_checkpoint_enabled", definition: "retry_checkpoint_enabled INTEGER" },
    { name: "retry_has_results", definition: "retry_has_results INTEGER" },
  ];

  for (const col of resilienceColumns) {
    if (!hasTableColumn(db, "resilience_events", col.name)) {
      db.run(`ALTER TABLE resilience_events ADD COLUMN ${col.definition}`);
    }
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

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resilience_events_delivery
    ON resilience_events(delivery_id)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_resilience_events_repo_created
    ON resilience_events(repo, created_at)
  `);

  // Replace legacy delivery-only idempotency index with composite identity.
  // Exactly-once semantics for rate-limit telemetry are keyed by
  // (delivery_id, event_type) when delivery_id is present.
  db.run(`
    DROP INDEX IF EXISTS idx_rate_limit_events_delivery
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_events_delivery_event
    ON rate_limit_events(delivery_id, event_type)
    WHERE delivery_id IS NOT NULL
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_rate_limit_events_repo_created
    ON rate_limit_events(repo, created_at)
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

  const insertResilienceEventStmt = db.query(`
    INSERT OR REPLACE INTO resilience_events (
      delivery_id, repo, pr_number, pr_author, event_type, kind,
      parent_delivery_id, review_output_key,
      execution_conclusion, had_inline_output,
      checkpoint_files_reviewed, checkpoint_finding_count, checkpoint_total_files, partial_comment_id,
      recent_timeouts, chronic_timeout,
      retry_enqueued, retry_files_count, retry_scope_ratio, retry_timeout_seconds,
      retry_risk_level, retry_checkpoint_enabled, retry_has_results
    ) VALUES (
      $deliveryId, $repo, $prNumber, $prAuthor, $eventType, $kind,
      $parentDeliveryId, $reviewOutputKey,
      $executionConclusion, $hadInlineOutput,
      $checkpointFilesReviewed, $checkpointFindingCount, $checkpointTotalFiles, $partialCommentId,
      $recentTimeouts, $chronicTimeout,
      $retryEnqueued, $retryFilesCount, $retryScopeRatio, $retryTimeoutSeconds,
      $retryRiskLevel, $retryCheckpointEnabled, $retryHasResults
    )
  `);

  const insertRateLimitEventStmt = db.query(`
    INSERT OR IGNORE INTO rate_limit_events (
      delivery_id, repo, pr_number, event_type,
      cache_hit_rate, skipped_queries, retry_attempts, degradation_path
    ) VALUES (
      $deliveryId, $repo, $prNumber, $eventType,
      $cacheHitRate, $skippedQueries, $retryAttempts, $degradationPath
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

    recordRateLimitEvent(entry: RateLimitEventRecord): void {
      try {
        insertRateLimitEventStmt.run({
          $deliveryId: entry.deliveryId ?? null,
          $repo: entry.repo,
          $prNumber: entry.prNumber ?? null,
          $eventType: entry.eventType,
          $cacheHitRate: entry.cacheHitRate,
          $skippedQueries: entry.skippedQueries,
          $retryAttempts: entry.retryAttempts,
          $degradationPath: entry.degradationPath,
        });
      } catch (err) {
        logger.warn({ err, deliveryId: entry.deliveryId, eventType: entry.eventType }, "Rate-limit telemetry write failed (non-blocking)");
      }

      bumpWriteCount();
    },

    recordResilienceEvent(entry: ResilienceEventRecord): void {
      insertResilienceEventStmt.run({
        $deliveryId: entry.deliveryId,
        $repo: entry.repo,
        $prNumber: entry.prNumber ?? null,
        $prAuthor: entry.prAuthor ?? null,
        $eventType: entry.eventType,
        $kind: entry.kind,
        $parentDeliveryId: entry.parentDeliveryId ?? null,
        $reviewOutputKey: entry.reviewOutputKey ?? null,
        $executionConclusion: entry.executionConclusion ?? null,
        $hadInlineOutput: entry.hadInlineOutput === undefined ? null : (entry.hadInlineOutput ? 1 : 0),
        $checkpointFilesReviewed: entry.checkpointFilesReviewed ?? null,
        $checkpointFindingCount: entry.checkpointFindingCount ?? null,
        $checkpointTotalFiles: entry.checkpointTotalFiles ?? null,
        $partialCommentId: entry.partialCommentId ?? null,
        $recentTimeouts: entry.recentTimeouts ?? null,
        $chronicTimeout: entry.chronicTimeout === undefined ? null : (entry.chronicTimeout ? 1 : 0),
        $retryEnqueued: entry.retryEnqueued === undefined ? null : (entry.retryEnqueued ? 1 : 0),
        $retryFilesCount: entry.retryFilesCount ?? null,
        $retryScopeRatio: entry.retryScopeRatio ?? null,
        $retryTimeoutSeconds: entry.retryTimeoutSeconds ?? null,
        $retryRiskLevel: entry.retryRiskLevel ?? null,
        $retryCheckpointEnabled: entry.retryCheckpointEnabled === undefined ? null : (entry.retryCheckpointEnabled ? 1 : 0),
        $retryHasResults: entry.retryHasResults === undefined ? null : (entry.retryHasResults ? 1 : 0),
      });

      bumpWriteCount();
    },

    purgeOlderThan(days: number): number {
      const modifier = `-${days} days`;

      const purgeExecutionsStmt = db.query(
        "DELETE FROM executions WHERE created_at < datetime('now', $modifier) RETURNING id",
      );
      const deletedExecutions = purgeExecutionsStmt.all({ $modifier: modifier });

      const purgeResilienceStmt = db.query(
        "DELETE FROM resilience_events WHERE created_at < datetime('now', $modifier) RETURNING id",
      );
      const deletedResilience = purgeResilienceStmt.all({ $modifier: modifier });

      const purgeRateLimitStmt = db.query(
        "DELETE FROM rate_limit_events WHERE created_at < datetime('now', $modifier) RETURNING id",
      );
      const deletedRateLimit = purgeRateLimitStmt.all({ $modifier: modifier });

      return deletedExecutions.length + deletedResilience.length + deletedRateLimit.length;
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
