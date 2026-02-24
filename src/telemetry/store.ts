import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  RateLimitEventRecord,
  RetrievalQualityRecord,
  ResilienceEventRecord,
  TelemetryRecord,
  TelemetryStore,
} from "./types.ts";

/**
 * Create a TelemetryStore backed by PostgreSQL via postgres.js.
 *
 * Uses tagged-template queries (automatically prepared) and relies on
 * the unified schema from migrations. Table names follow the PostgreSQL
 * schema: telemetry_events (was executions), retrieval_quality_events
 * (was retrieval_quality), resilience_events, rate_limit_events.
 */
export function createTelemetryStore(opts: {
  sql: Sql;
  logger: Logger;
  rateLimitFailureInjectionIdentities?: string[];
}): TelemetryStore {
  const { sql, logger } = opts;
  const rateLimitFailureInjectionIdentities = new Set(
    (opts.rateLimitFailureInjectionIdentities ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );

  const store: TelemetryStore = {
    async record(entry: TelemetryRecord): Promise<void> {
      await sql`
        INSERT INTO telemetry_events (
          delivery_id, repo, pr_number, pr_author, event_type, provider, model,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason
        ) VALUES (
          ${entry.deliveryId ?? null}, ${entry.repo}, ${entry.prNumber ?? null},
          ${entry.prAuthor ?? null}, ${entry.eventType}, ${entry.provider ?? "anthropic"},
          ${entry.model},
          ${entry.inputTokens ?? 0}, ${entry.outputTokens ?? 0},
          ${entry.cacheReadTokens ?? 0}, ${entry.cacheCreationTokens ?? 0},
          ${entry.durationMs ?? 0}, ${entry.costUsd ?? 0}, ${entry.conclusion},
          ${entry.sessionId ?? null}, ${entry.numTurns ?? null}, ${entry.stopReason ?? null}
        )
      `;
    },

    async countRecentTimeouts(repo: string, author: string): Promise<number> {
      const [row] = await sql`
        SELECT COUNT(*) AS cnt FROM telemetry_events
        WHERE repo = ${repo} AND pr_author = ${author}
          AND conclusion IN ('timeout', 'timeout_partial')
          AND created_at > now() - interval '7 days'
      `;
      return Number(row?.cnt ?? 0);
    },

    async recordRetrievalQuality(entry: RetrievalQualityRecord): Promise<void> {
      await sql`
        INSERT INTO retrieval_quality_events (
          delivery_id, repo, pr_number, event_type,
          top_k, distance_threshold, result_count, avg_distance, language_match_ratio,
          threshold_method
        ) VALUES (
          ${entry.deliveryId ?? null}, ${entry.repo}, ${entry.prNumber ?? null},
          ${entry.eventType},
          ${entry.topK ?? null}, ${entry.distanceThreshold ?? null}, ${entry.resultCount},
          ${entry.avgDistance ?? null}, ${entry.languageMatchRatio ?? null},
          ${entry.thresholdMethod ?? null}
        )
        ON CONFLICT (delivery_id) WHERE delivery_id IS NOT NULL DO NOTHING
      `;
    },

    async recordRateLimitEvent(entry: RateLimitEventRecord): Promise<void> {
      const executionIdentity = entry.executionIdentity
        ?? entry.deliveryId
        ?? `${entry.repo}#${entry.eventType}#${entry.prNumber ?? "none"}`;

      if (rateLimitFailureInjectionIdentities.has(executionIdentity)) {
        logger.warn(
          {
            executionIdentity,
            deliveryId: entry.deliveryId,
            eventType: entry.eventType,
            repo: entry.repo,
            prNumber: entry.prNumber,
            verificationMode: "rate-limit-failure-injection",
          },
          "Rate-limit telemetry write forced to fail",
        );
        throw new Error(`Forced rate-limit telemetry write failure for identity '${executionIdentity}'`);
      }

      try {
        await sql`
          INSERT INTO rate_limit_events (
            delivery_id, repo, pr_number, event_type,
            cache_hit_rate, skipped_queries, retry_attempts, degradation_path
          ) VALUES (
            ${entry.deliveryId ?? null}, ${entry.repo}, ${entry.prNumber ?? null},
            ${entry.eventType},
            ${entry.cacheHitRate}, ${entry.skippedQueries}, ${entry.retryAttempts},
            ${entry.degradationPath}
          )
          ON CONFLICT (delivery_id, event_type) WHERE delivery_id IS NOT NULL DO NOTHING
        `;
      } catch (err) {
        logger.warn(
          {
            err,
            executionIdentity,
            deliveryId: entry.deliveryId,
            eventType: entry.eventType,
            repo: entry.repo,
            prNumber: entry.prNumber,
          },
          "Rate-limit telemetry write failed",
        );
        throw err;
      }
    },

    async recordResilienceEvent(entry: ResilienceEventRecord): Promise<void> {
      await sql`
        INSERT INTO resilience_events (
          delivery_id, repo, pr_number, pr_author, event_type, kind,
          parent_delivery_id, review_output_key,
          execution_conclusion, had_inline_output,
          checkpoint_files_reviewed, checkpoint_finding_count, checkpoint_total_files, partial_comment_id,
          recent_timeouts, chronic_timeout,
          retry_enqueued, retry_files_count, retry_scope_ratio, retry_timeout_seconds,
          retry_risk_level, retry_checkpoint_enabled, retry_has_results
        ) VALUES (
          ${entry.deliveryId}, ${entry.repo}, ${entry.prNumber ?? null}, ${entry.prAuthor ?? null},
          ${entry.eventType}, ${entry.kind},
          ${entry.parentDeliveryId ?? null}, ${entry.reviewOutputKey ?? null},
          ${entry.executionConclusion ?? null},
          ${entry.hadInlineOutput === undefined ? null : entry.hadInlineOutput},
          ${entry.checkpointFilesReviewed ?? null}, ${entry.checkpointFindingCount ?? null},
          ${entry.checkpointTotalFiles ?? null}, ${entry.partialCommentId ?? null},
          ${entry.recentTimeouts ?? null},
          ${entry.chronicTimeout === undefined ? null : entry.chronicTimeout},
          ${entry.retryEnqueued === undefined ? null : entry.retryEnqueued},
          ${entry.retryFilesCount ?? null}, ${entry.retryScopeRatio ?? null},
          ${entry.retryTimeoutSeconds ?? null}, ${entry.retryRiskLevel ?? null},
          ${entry.retryCheckpointEnabled === undefined ? null : entry.retryCheckpointEnabled},
          ${entry.retryHasResults === undefined ? null : entry.retryHasResults}
        )
        ON CONFLICT (delivery_id)
        DO UPDATE SET
          repo = EXCLUDED.repo,
          pr_number = EXCLUDED.pr_number,
          pr_author = EXCLUDED.pr_author,
          event_type = EXCLUDED.event_type,
          kind = EXCLUDED.kind,
          parent_delivery_id = EXCLUDED.parent_delivery_id,
          review_output_key = EXCLUDED.review_output_key,
          execution_conclusion = EXCLUDED.execution_conclusion,
          had_inline_output = EXCLUDED.had_inline_output,
          checkpoint_files_reviewed = EXCLUDED.checkpoint_files_reviewed,
          checkpoint_finding_count = EXCLUDED.checkpoint_finding_count,
          checkpoint_total_files = EXCLUDED.checkpoint_total_files,
          partial_comment_id = EXCLUDED.partial_comment_id,
          recent_timeouts = EXCLUDED.recent_timeouts,
          chronic_timeout = EXCLUDED.chronic_timeout,
          retry_enqueued = EXCLUDED.retry_enqueued,
          retry_files_count = EXCLUDED.retry_files_count,
          retry_scope_ratio = EXCLUDED.retry_scope_ratio,
          retry_timeout_seconds = EXCLUDED.retry_timeout_seconds,
          retry_risk_level = EXCLUDED.retry_risk_level,
          retry_checkpoint_enabled = EXCLUDED.retry_checkpoint_enabled,
          retry_has_results = EXCLUDED.retry_has_results
      `;
    },

    async purgeOlderThan(days: number): Promise<number> {
      const interval = `${days} days`;

      const r1 = await sql`
        DELETE FROM telemetry_events WHERE created_at < now() - ${interval}::interval
      `;
      const r2 = await sql`
        DELETE FROM resilience_events WHERE created_at < now() - ${interval}::interval
      `;
      const r3 = await sql`
        DELETE FROM rate_limit_events WHERE created_at < now() - ${interval}::interval
      `;

      return r1.count + r2.count + r3.count;
    },

    checkpoint(): void {
      // No-op: PostgreSQL has no WAL checkpoint equivalent needed
    },

    close(): void {
      // No-op: connection lifecycle managed by client.ts
    },
  };

  logger.debug("TelemetryStore initialized (PostgreSQL)");
  return store;
}
