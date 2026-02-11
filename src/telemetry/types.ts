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
 * TelemetryStore interface for SQLite-backed execution telemetry.
 *
 * Created via `createTelemetryStore({ dbPath, logger })` factory function.
 * Uses WAL mode, prepared statements, and auto-checkpoint every 1000 writes.
 */
export type TelemetryStore = {
  /** Insert a telemetry record into the executions table. */
  record(entry: TelemetryRecord): void;
  /** Delete rows older than the given number of days. Returns count of deleted rows. */
  purgeOlderThan(days: number): number;
  /** Run a WAL checkpoint (PASSIVE mode). */
  checkpoint(): void;
  /** Close the database connection. */
  close(): void;
};
