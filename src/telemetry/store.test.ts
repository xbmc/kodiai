import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import { createTelemetryStore } from "./store.ts";
import type { TelemetryStore } from "./types.ts";
import type { ResilienceEventRecord } from "./types.ts";
import type { RateLimitEventRecord } from "./types.ts";
import type { Sql } from "../db/client.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://kodiai:kodiai@localhost:5432/kodiai";

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

function createWarnCaptureLogger() {
  const warnings: Array<{ data: unknown; message: string }> = [];
  const logger = {
    info: () => {},
    warn: (data: unknown, message: string) => {
      warnings.push({ data, message });
    },
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: "silent",
  } as unknown as import("pino").Logger;

  return { logger, warnings };
}

function makeRecord(overrides: Partial<Parameters<TelemetryStore["record"]>[0]> = {}) {
  return {
    repo: "owner/repo",
    eventType: "pull_request.opened",
    model: "claude-sonnet-4-5-20250929",
    conclusion: "success",
    ...overrides,
  };
}

function makeRetrievalQualityRecord(
  overrides: Partial<Parameters<TelemetryStore["recordRetrievalQuality"]>[0]> = {},
) {
  return {
    repo: "owner/repo",
    eventType: "pull_request.opened",
    resultCount: 0,
    ...overrides,
  };
}

function makeResilienceEventRecord(overrides: Partial<ResilienceEventRecord> = {}): ResilienceEventRecord {
  return {
    deliveryId: "delivery-xyz",
    repo: "owner/repo",
    eventType: "pull_request.review_requested",
    kind: "timeout",
    ...overrides,
  };
}

function makeRateLimitEventRecord(overrides: Partial<RateLimitEventRecord> = {}): RateLimitEventRecord {
  return {
    repo: "owner/repo",
    eventType: "pull_request.review_requested",
    cacheHitRate: 0,
    skippedQueries: 0,
    retryAttempts: 0,
    degradationPath: "none",
    ...overrides,
  };
}

let sql: Sql;
let store: TelemetryStore;

/** Truncate all telemetry-related tables for test isolation. */
async function truncateAll(): Promise<void> {
  await sql`TRUNCATE
    rate_limit_events,
    resilience_events,
    retrieval_quality_events,
    telemetry_events
    CASCADE`;
}

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  store = createTelemetryStore({ sql, logger: mockLogger });
});

afterAll(async () => {
  await sql.end();
});

describe("TelemetryStore", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("record() inserts a row with correct fields", async () => {
    await store.record(
      makeRecord({
        deliveryId: "abc-123",
        repo: "octocat/hello-world",
        prNumber: 42,
        eventType: "pull_request.opened",
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        durationMs: 3000,
        costUsd: 0.05,
        conclusion: "success",
        sessionId: "sess-001",
        numTurns: 5,
        stopReason: "end_turn",
      }),
    );

    const [row] = await sql`SELECT * FROM telemetry_events WHERE delivery_id = 'abc-123'`;
    expect(row).toBeTruthy();
    expect(row.repo).toBe("octocat/hello-world");
    expect(row.pr_number).toBe(42);
    expect(row.event_type).toBe("pull_request.opened");
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe("claude-sonnet-4-5-20250929");
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(500);
    expect(row.cache_read_tokens).toBe(200);
    expect(row.cache_creation_tokens).toBe(100);
    expect(row.duration_ms).toBe(3000);
    expect(row.cost_usd).toBe(0.05);
    expect(row.conclusion).toBe("success");
    expect(row.session_id).toBe("sess-001");
    expect(row.num_turns).toBe(5);
    expect(row.stop_reason).toBe("end_turn");
    expect(row.created_at).toBeTruthy();
  });

  test("record() with minimal fields applies defaults", async () => {
    await store.record(makeRecord());

    const [row] = await sql`SELECT * FROM telemetry_events LIMIT 1`;
    expect(row).toBeTruthy();
    expect(row.provider).toBe("anthropic");
    expect(row.input_tokens).toBe(0);
    expect(row.output_tokens).toBe(0);
    expect(row.cache_read_tokens).toBe(0);
    expect(row.cache_creation_tokens).toBe(0);
    expect(row.duration_ms).toBe(0);
    expect(row.cost_usd).toBe(0);
    expect(row.delivery_id).toBeNull();
    expect(row.pr_number).toBeNull();
    expect(row.session_id).toBeNull();
    expect(row.num_turns).toBeNull();
    expect(row.stop_reason).toBeNull();
  });

  test("purgeOlderThan(0) deletes all rows and returns count", async () => {
    await store.record(makeRecord());

    // Manually backdate
    await sql`UPDATE telemetry_events SET created_at = now() - interval '1 day'`;

    const purged = await store.purgeOlderThan(0);
    expect(purged).toBe(1);
  });

  test("purgeOlderThan(90) preserves recent rows", async () => {
    await store.record(makeRecord());

    const purged = await store.purgeOlderThan(90);
    expect(purged).toBe(0);

    const [result] = await sql`SELECT COUNT(*) AS cnt FROM telemetry_events`;
    expect(Number(result.cnt)).toBe(1);
  });

  test("checkpoint() runs without error", async () => {
    await store.record(makeRecord());
    expect(() => store.checkpoint()).not.toThrow();
  });

  test("close() does not throw", () => {
    expect(() => store.close()).not.toThrow();
  });

  test("recordRetrievalQuality() inserts a row and is idempotent by delivery_id", async () => {
    await store.recordRetrievalQuality(
      makeRetrievalQualityRecord({
        deliveryId: "deliv-001",
        repo: "octocat/hello-world",
        prNumber: 123,
        eventType: "pull_request.opened",
        topK: 8,
        distanceThreshold: 0.3,
        resultCount: 2,
        avgDistance: 0.25,
        languageMatchRatio: 0.5,
      }),
    );

    // Duplicate delivery id should not create a second row.
    await store.recordRetrievalQuality(
      makeRetrievalQualityRecord({
        deliveryId: "deliv-001",
        repo: "octocat/hello-world",
        prNumber: 123,
        eventType: "pull_request.opened",
        topK: 8,
        distanceThreshold: 0.3,
        resultCount: 2,
        avgDistance: 0.25,
        languageMatchRatio: 0.5,
      }),
    );

    const [row] = await sql`
      SELECT * FROM retrieval_quality_events WHERE delivery_id = 'deliv-001'
    `;
    const [count] = await sql`
      SELECT COUNT(*) AS cnt FROM retrieval_quality_events WHERE delivery_id = 'deliv-001'
    `;

    expect(row).toBeTruthy();
    expect(row.repo).toBe("octocat/hello-world");
    expect(row.pr_number).toBe(123);
    expect(row.event_type).toBe("pull_request.opened");
    expect(row.top_k).toBe(8);
    expect(row.distance_threshold).toBe(0.3);
    expect(row.result_count).toBe(2);
    expect(row.avg_distance).toBe(0.25);
    expect(row.language_match_ratio).toBe(0.5);
    expect(row.created_at).toBeTruthy();
    expect(Number(count.cnt)).toBe(1);
  });

  test("recordResilienceEvent() inserts a row and is idempotent by delivery_id", async () => {
    expect(typeof store.recordResilienceEvent).toBe("function");

    await store.recordResilienceEvent?.(
      makeResilienceEventRecord({
        deliveryId: "res-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        prAuthor: "octocat",
        kind: "timeout",
        eventType: "pull_request.opened",
        reviewOutputKey: "rok-1",
        executionConclusion: "timeout",
        checkpointFilesReviewed: 3,
        checkpointFindingCount: 2,
        checkpointTotalFiles: 10,
        partialCommentId: 123,
        retryEnqueued: true,
        retryFilesCount: 4,
        retryScopeRatio: 0.6,
        retryTimeoutSeconds: 120,
        retryRiskLevel: "medium",
        retryCheckpointEnabled: true,
      }),
    );

    // Re-write same delivery id with different fields.
    await store.recordResilienceEvent?.(
      makeResilienceEventRecord({
        deliveryId: "res-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        prAuthor: "octocat",
        kind: "timeout",
        eventType: "pull_request.opened",
        executionConclusion: "timeout_partial",
        checkpointFilesReviewed: 4,
      }),
    );

    const [row] = await sql`SELECT * FROM resilience_events WHERE delivery_id = 'res-001'`;
    const [count] = await sql`SELECT COUNT(*) AS cnt FROM resilience_events WHERE delivery_id = 'res-001'`;

    expect(Number(count.cnt)).toBe(1);
    expect(row.repo).toBe("octocat/hello-world");
    expect(row.pr_number).toBe(7);
    expect(row.pr_author).toBe("octocat");
    expect(row.kind).toBe("timeout");
    expect(row.execution_conclusion).toBe("timeout_partial");
    expect(row.checkpoint_files_reviewed).toBe(4);
    expect(row.created_at).toBeTruthy();
  });

  test("recordRateLimitEvent() is idempotent by delivery_id + event_type", async () => {
    await store.recordRateLimitEvent(
      makeRateLimitEventRecord({
        deliveryId: "rate-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        eventType: "pull_request.review_requested",
        cacheHitRate: 0.75,
        skippedQueries: 0,
        retryAttempts: 1,
        degradationPath: "none",
      }),
    );

    await store.recordRateLimitEvent(
      makeRateLimitEventRecord({
        deliveryId: "rate-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        eventType: "pull_request.review_requested",
        cacheHitRate: 1,
        skippedQueries: 0,
        retryAttempts: 0,
        degradationPath: "none",
      }),
    );

    // Same delivery id + different event type should persist as a distinct row.
    await store.recordRateLimitEvent(
      makeRateLimitEventRecord({
        deliveryId: "rate-001",
        repo: "octocat/hello-world",
        prNumber: 7,
        eventType: "pull_request.opened",
        cacheHitRate: 0,
        skippedQueries: 1,
        retryAttempts: 1,
        degradationPath: "search-api-rate-limit",
      }),
    );

    const [reviewRequestedRow] = await sql`
      SELECT * FROM rate_limit_events WHERE delivery_id = 'rate-001' AND event_type = 'pull_request.review_requested'
    `;
    const [openedRow] = await sql`
      SELECT * FROM rate_limit_events WHERE delivery_id = 'rate-001' AND event_type = 'pull_request.opened'
    `;
    const [count] = await sql`
      SELECT COUNT(*) AS cnt FROM rate_limit_events WHERE delivery_id = 'rate-001'
    `;

    expect(Number(count.cnt)).toBe(2);
    expect(reviewRequestedRow.repo).toBe("octocat/hello-world");
    expect(reviewRequestedRow.pr_number).toBe(7);
    expect(reviewRequestedRow.event_type).toBe("pull_request.review_requested");
    expect(reviewRequestedRow.cache_hit_rate).toBe(0.75);
    expect(reviewRequestedRow.skipped_queries).toBe(0);
    expect(reviewRequestedRow.retry_attempts).toBe(1);
    expect(reviewRequestedRow.degradation_path).toBe("none");
    expect(reviewRequestedRow.created_at).toBeTruthy();
    expect(openedRow.event_type).toBe("pull_request.opened");
    expect(openedRow.cache_hit_rate).toBe(0);
    expect(openedRow.skipped_queries).toBe(1);
    expect(openedRow.retry_attempts).toBe(1);
    expect(openedRow.degradation_path).toBe("search-api-rate-limit");
  });

  test("recordRateLimitEvent() ignores replayed writes for same delivery/event identity", async () => {
    await store.recordRateLimitEvent(
      makeRateLimitEventRecord({
        deliveryId: "rate-replay-001",
        eventType: "pull_request.review_requested",
        cacheHitRate: 0,
        skippedQueries: 1,
        retryAttempts: 1,
        degradationPath: "search-api-rate-limit",
      }),
    );

    // Simulate replay/retry attempts trying to emit duplicate telemetry.
    for (let i = 0; i < 3; i++) {
      await store.recordRateLimitEvent(
        makeRateLimitEventRecord({
          deliveryId: "rate-replay-001",
          eventType: "pull_request.review_requested",
          cacheHitRate: 1,
          skippedQueries: 0,
          retryAttempts: 0,
          degradationPath: "none",
        }),
      );
    }

    const [row] = await sql`
      SELECT * FROM rate_limit_events WHERE delivery_id = 'rate-replay-001' AND event_type = 'pull_request.review_requested'
    `;
    const [count] = await sql`
      SELECT COUNT(*) AS cnt FROM rate_limit_events WHERE delivery_id = 'rate-replay-001' AND event_type = 'pull_request.review_requested'
    `;

    expect(Number(count.cnt)).toBe(1);
    expect(row.cache_hit_rate).toBe(0);
    expect(row.skipped_queries).toBe(1);
    expect(row.retry_attempts).toBe(1);
    expect(row.degradation_path).toBe("search-api-rate-limit");
  });

  test("recordRateLimitEvent() forces configured identity failures without writing duplicate rows", async () => {
    const { logger: captureLogger, warnings } = createWarnCaptureLogger();

    const injectedStore = createTelemetryStore({
      sql,
      logger: captureLogger,
      rateLimitFailureInjectionIdentities: ["delivery-injected-001"],
    });

    expect(
      injectedStore.recordRateLimitEvent(
        makeRateLimitEventRecord({
          deliveryId: "delivery-injected-001",
          eventType: "pull_request.review_requested",
        }),
      ),
    ).rejects.toThrow("Forced rate-limit telemetry write failure");

    // Wait for the rejection to be processed
    try {
      await injectedStore.recordRateLimitEvent(
        makeRateLimitEventRecord({
          deliveryId: "delivery-injected-001",
          eventType: "pull_request.review_requested",
        }),
      );
    } catch {
      // Expected
    }

    const [count] = await sql`
      SELECT COUNT(*) AS cnt FROM rate_limit_events WHERE delivery_id = 'delivery-injected-001'
    `;

    expect(Number(count.cnt)).toBe(0);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toBe("Rate-limit telemetry write forced to fail");
    expect((warnings[0]?.data as { executionIdentity?: string }).executionIdentity).toBe("delivery-injected-001");
  });

  test("recordRateLimitEvent() supports deterministic fallback identity injection without delivery id", async () => {
    const fallbackIdentity = "owner/repo#pull_request.review_requested#77";

    const injectedStore = createTelemetryStore({
      sql,
      logger: mockLogger,
      rateLimitFailureInjectionIdentities: [fallbackIdentity],
    });

    try {
      await injectedStore.recordRateLimitEvent(
        makeRateLimitEventRecord({
          deliveryId: undefined,
          repo: "owner/repo",
          prNumber: 77,
          eventType: "pull_request.review_requested",
        }),
      );
    } catch {
      // Expected
    }

    const [count] = await sql`
      SELECT COUNT(*) AS cnt FROM rate_limit_events WHERE repo = 'owner/repo' AND pr_number = 77
    `;

    expect(Number(count.cnt)).toBe(0);
  });
});
