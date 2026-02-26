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
  prAuthor?: string;
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
 * Resilience/timeout metadata for a review execution.
 *
 * Stored separately from `executions` so we can add structured fields for
 * checkpoint/retry behavior without affecting existing timeout counting.
 */
export type ResilienceEventRecord = {
  /** Correlates with `executions.delivery_id` (required for join/reporting). */
  deliveryId: string;
  repo: string;
  prNumber?: number;
  prAuthor?: string;
  eventType: string;
  /** Classifies the record: initial timeout handling vs retry attempt. */
  kind: "timeout" | "retry";
  /** For retry records, the parent delivery id (original attempt). */
  parentDeliveryId?: string;
  reviewOutputKey?: string;

  executionConclusion?: string;
  hadInlineOutput?: boolean;

  checkpointFilesReviewed?: number;
  checkpointFindingCount?: number;
  checkpointTotalFiles?: number;
  partialCommentId?: number;

  recentTimeouts?: number;
  chronicTimeout?: boolean;

  retryEnqueued?: boolean;
  retryFilesCount?: number;
  retryScopeRatio?: number;
  retryTimeoutSeconds?: number;
  retryRiskLevel?: string;
  retryCheckpointEnabled?: boolean;
  retryHasResults?: boolean;
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
 * Rate-limit telemetry for Search enrichment behavior.
 *
 * Maps to the `rate_limit_events` table in the telemetry SQLite database.
 */
export type RateLimitEventRecord = {
  /**
   * Optional webhook delivery id.
   *
   * Exactly-once identity for rate-limit telemetry is the composite
   * `(deliveryId, eventType)` pair when `deliveryId` is present.
   */
  deliveryId?: string;
  repo: string;
  prNumber?: number;
  eventType: string;
  cacheHitRate: number;
  skippedQueries: number;
  retryAttempts: number;
  degradationPath: string;
  /**
   * Optional deterministic execution identity for verification-only tooling.
   *
   * When absent, the store derives a deterministic fallback identity.
   */
  executionIdentity?: string;
};

/**
 * LLM cost tracking record for per-invocation cost visibility.
 * Maps to the `llm_cost_events` table.
 * Tracks both AI SDK and Agent SDK invocations.
 */
export type LlmCostRecord = {
  deliveryId?: string;
  repo: string;
  taskType: string;
  model: string;
  provider: string;
  sdk: "agent" | "ai";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd: number;
  durationMs?: number;
  usedFallback: boolean;
  fallbackReason?: string;
  error?: string;
};

/**
 * TelemetryStore interface for PostgreSQL-backed execution telemetry.
 *
 * Created via `createTelemetryStore({ sql, logger })` factory function.
 * Uses postgres.js tagged-template queries with automatic prepared statements.
 */
export type TelemetryStore = {
  /** Insert a telemetry record into the telemetry_events table. */
  record(entry: TelemetryRecord): Promise<void>;
  /** Count timeouts for repo+author in last 7 days. */
  countRecentTimeouts?(repo: string, author: string): Promise<number>;
  /** Insert a retrieval quality record into the retrieval_quality_events table. */
  recordRetrievalQuality(entry: RetrievalQualityRecord): Promise<void>;
  /** Insert Search rate-limit telemetry for observability. */
  recordRateLimitEvent(entry: RateLimitEventRecord): Promise<void>;
  /** Insert structured checkpoint/retry metadata for resilience monitoring. */
  recordResilienceEvent?(entry: ResilienceEventRecord): Promise<void>;
  /** Insert an LLM cost tracking record into the llm_cost_events table. */
  recordLlmCost(entry: LlmCostRecord): Promise<void>;
  /** Delete rows older than the given number of days. Returns count of deleted rows. */
  purgeOlderThan(days: number): Promise<number>;
  /** No-op: PostgreSQL has no WAL checkpoint equivalent needed. */
  checkpoint(): void;
  /** No-op: connection lifecycle managed by client.ts. */
  close(): void;
};
