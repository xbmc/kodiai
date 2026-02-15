/**
 * Telemetry record representing a single execution event.
 *
 * Maps to the `executions` table in the telemetry SQLite database.
 * All optional fields have sensible defaults applied at the store layer.
 */
export type TelemetryRecord = {
  deliveryId?: string;
  repo: string;
  prNumber?: number;
  eventType: string;
  provider?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs?: number;
  costUsd?: number;
  conclusion: string;
  sessionId?: string;
  numTurns?: number;
  stopReason?: string;
};

/**
 * Retrieval quality telemetry for a retrieval attempt.
 *
 * Maps to the `retrieval_quality` table in the telemetry SQLite database.
 */
export type RetrievalQualityRecord = {
  deliveryId?: string;
  repo: string;
  prNumber?: number;
  eventType: string;
  topK?: number;
  distanceThreshold?: number;
  resultCount: number;
  /** Mean of reranked/adjusted distances (null/undefined when resultCount=0). */
  avgDistance?: number | null;
  /** Matches / resultCount (null/undefined when resultCount=0). */
  languageMatchRatio?: number | null;
  /** How the distance threshold was selected: 'adaptive', 'percentile', or 'configured'. */
  thresholdMethod?: string;
};

/**
 * TelemetryStore interface for SQLite-backed execution telemetry.
 *
 * Created via `createTelemetryStore({ dbPath, logger })` factory function.
 * Uses WAL mode, prepared statements, and auto-checkpoint every 1000 writes.
 */
export type TelemetryStore = {
  /** Insert a telemetry record into the executions table. */
  record(entry: TelemetryRecord): void;
  /** Insert a retrieval quality record into the retrieval_quality table. */
  recordRetrievalQuality(entry: RetrievalQualityRecord): void;
  /** Delete rows older than the given number of days. Returns count of deleted rows. */
  purgeOlderThan(days: number): number;
  /** Run a WAL checkpoint (PASSIVE mode). */
  checkpoint(): void;
  /** Close the database connection. */
  close(): void;
};
