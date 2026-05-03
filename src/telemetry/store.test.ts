import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import postgres from "postgres";
import { createTelemetryStore } from "./store.ts";
import type { TelemetryStore } from "./types.ts";
import type { PromptSectionRecord, ResilienceEventRecord, RateLimitEventRecord } from "./types.ts";
import type { Sql } from "../db/client.ts";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

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

function makePromptSectionRecord(overrides: Partial<PromptSectionRecord> = {}): PromptSectionRecord {
  return {
    deliveryId: "prompt-001",
    repo: "owner/repo",
    taskType: "review.full",
    promptKind: "user",
    sections: [
      {
        sectionName: "system-policy",
        sectionPosition: 0,
        charCount: 240,
        estimatedTokens: 60,
      },
      {
        sectionName: "diff-context",
        sectionPosition: 1,
        charCount: 800,
        estimatedTokens: 200,
        truncated: true,
      },
    ],
    ...overrides,
  };
}

let sql: Sql;
let store: TelemetryStore;

/** Truncate all telemetry-related tables for test isolation. */
async function truncateAll(): Promise<void> {
  await sql`TRUNCATE
    prompt_section_events,
    llm_cost_events,
    rate_limit_events,
    resilience_events,
    retrieval_quality_events,
    telemetry_events
    CASCADE`;
}

describe.skipIf(!TEST_DB_URL)("TelemetryStore", () => {
  beforeAll(async () => {
    sql = postgres(TEST_DB_URL!, { max: 5, idle_timeout: 20, connect_timeout: 10 });
    store = createTelemetryStore({ sql, logger: mockLogger });
  });

  afterAll(async () => {
    await sql.end();
  });
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
    expect(row!.repo).toBe("octocat/hello-world");
    expect(row!.pr_number).toBe(42);
    expect(row!.event_type).toBe("pull_request.opened");
    expect(row!.provider).toBe("anthropic");
    expect(row!.model).toBe("claude-sonnet-4-5-20250929");
    expect(row!.input_tokens).toBe(1000);
    expect(row!.output_tokens).toBe(500);
    expect(row!.cache_read_tokens).toBe(200);
    expect(row!.cache_creation_tokens).toBe(100);
    expect(row!.duration_ms).toBe(3000);
    expect(row!.cost_usd).toBe(0.05);
    expect(row!.conclusion).toBe("success");
    expect(row!.session_id).toBe("sess-001");
    expect(row!.num_turns).toBe(5);
    expect(row!.stop_reason).toBe("end_turn");
    expect(row!.created_at).toBeTruthy();
  });

  test("record() with minimal fields applies defaults", async () => {
    await store.record(makeRecord());

    const [row] = await sql`SELECT * FROM telemetry_events LIMIT 1`;
    expect(row).toBeTruthy();
    expect(row!.provider).toBe("anthropic");
    expect(row!.input_tokens).toBe(0);
    expect(row!.output_tokens).toBe(0);
    expect(row!.cache_read_tokens).toBe(0);
    expect(row!.cache_creation_tokens).toBe(0);
    expect(row!.duration_ms).toBe(0);
    expect(row!.cost_usd).toBe(0);
    expect(row!.delivery_id).toBeNull();
    expect(row!.pr_number).toBeNull();
    expect(row!.session_id).toBeNull();
    expect(row!.num_turns).toBeNull();
    expect(row!.stop_reason).toBeNull();
  });

  test("recordPromptSections() inserts ordered prompt-section rows without raw prompt text", async () => {
    await store.recordPromptSections(
      makePromptSectionRecord({
        deliveryId: "prompt-ordered-001",
        taskType: "mention.response",
        promptKind: "user",
      }),
    );

    const rows = await sql`
      SELECT delivery_id, repo, task_type, prompt_kind, section_name, section_position,
             char_count, estimated_tokens, truncated, created_at
      FROM prompt_section_events
      WHERE delivery_id = 'prompt-ordered-001'
      ORDER BY section_position ASC
    `;

    expect(rows).toHaveLength(2);
    expect(rows[0]?.task_type).toBe("mention.response");
    expect(rows[0]?.prompt_kind).toBe("user");
    expect(rows[0]?.section_name).toBe("system-policy");
    expect(rows[0]?.section_position).toBe(0);
    expect(rows[0]?.char_count).toBe(240);
    expect(rows[0]?.estimated_tokens).toBe(60);
    expect(rows[0]?.truncated).toBe(false);
    expect(rows[0]?.created_at).toBeTruthy();
    expect(rows[1]?.section_name).toBe("diff-context");
    expect(rows[1]?.truncated).toBe(true);
  });

  test("recordPromptSections() upserts by delivery/task/prompt path and keeps text-free metrics only", async () => {
    await store.recordPromptSections(
      makePromptSectionRecord({
        deliveryId: "prompt-upsert-001",
        sections: [
          {
            sectionName: "instruction-block",
            sectionPosition: 0,
            charCount: 120,
            estimatedTokens: 30,
          },
        ],
      }),
    );

    await store.recordPromptSections(
      makePromptSectionRecord({
        deliveryId: "prompt-upsert-001",
        sections: [
          {
            sectionName: "instruction-block",
            sectionPosition: 0,
            charCount: 144,
            estimatedTokens: 36,
            truncated: true,
          },
        ],
      }),
    );

    const rows = await sql`
      SELECT section_name, char_count, estimated_tokens, truncated
      FROM prompt_section_events
      WHERE delivery_id = 'prompt-upsert-001'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.section_name).toBe("instruction-block");
    expect(rows[0]?.char_count).toBe(144);
    expect(rows[0]?.estimated_tokens).toBe(36);
    expect(rows[0]?.truncated).toBe(true);

    const columns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'prompt_section_events'
      ORDER BY column_name ASC
    `;
    const columnNames = columns.map((row) => String(row.column_name));
    expect(columnNames).not.toContain("prompt_text");
    expect(columnNames).not.toContain("raw_prompt");
    expect(columnNames).not.toContain("section_text");
  });

  test("recordLlmCost() inserts task-path attribution rows", async () => {
    await store.recordLlmCost({
      deliveryId: "llm-cost-001",
      repo: "octocat/hello-world",
      taskType: "slack.response",
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      sdk: "agent",
      inputTokens: 321,
      outputTokens: 123,
      cacheReadTokens: 44,
      cacheWriteTokens: 11,
      estimatedCostUsd: 0.01234567,
      durationMs: 2200,
      usedFallback: false,
    });

    const [row] = await sql`
      SELECT delivery_id, repo, task_type, model, provider, sdk,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
             estimated_cost_usd, duration_ms, used_fallback
      FROM llm_cost_events
      WHERE delivery_id = 'llm-cost-001'
    `;

    expect(row).toBeTruthy();
    expect(row?.repo).toBe("octocat/hello-world");
    expect(row?.task_type).toBe("slack.response");
    expect(row?.input_tokens).toBe(321);
    expect(row?.output_tokens).toBe(123);
    expect(row?.cache_read_tokens).toBe(44);
    expect(row?.cache_write_tokens).toBe(11);
    expect(Number(row?.estimated_cost_usd)).toBeCloseTo(0.01234567, 8);
    expect(row?.duration_ms).toBe(2200);
    expect(row?.used_fallback).toBe(false);
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
    expect(Number(result!.cnt)).toBe(1);
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
    expect(row!.repo).toBe("octocat/hello-world");
    expect(row!.pr_number).toBe(123);
    expect(row!.event_type).toBe("pull_request.opened");
    expect(row!.top_k).toBe(8);
    expect(row!.distance_threshold).toBe(0.3);
    expect(row!.result_count).toBe(2);
    expect(row!.avg_distance).toBe(0.25);
    expect(row!.language_match_ratio).toBe(0.5);
    expect(row!.created_at).toBeTruthy();
    expect(Number(count!.cnt)).toBe(1);
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
        checkpointFilesInspected: 5,
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
        checkpointFilesInspected: 6,
      }),
    );

    const [row] = await sql`SELECT * FROM resilience_events WHERE delivery_id = 'res-001'`;
    const [count] = await sql`SELECT COUNT(*) AS cnt FROM resilience_events WHERE delivery_id = 'res-001'`;

    expect(Number(count!.cnt)).toBe(1);
    expect(row!.repo).toBe("octocat/hello-world");
    expect(row!.pr_number).toBe(7);
    expect(row!.pr_author).toBe("octocat");
    expect(row!.kind).toBe("timeout");
    expect(row!.execution_conclusion).toBe("timeout_partial");
    expect(row!.checkpoint_files_reviewed).toBe(4);
    expect(row!.checkpoint_files_inspected).toBe(6);
    expect(row!.created_at).toBeTruthy();
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

    expect(Number(count!.cnt)).toBe(2);
    expect(reviewRequestedRow!.repo).toBe("octocat/hello-world");
    expect(reviewRequestedRow!.pr_number).toBe(7);
    expect(reviewRequestedRow!.event_type).toBe("pull_request.review_requested");
    expect(reviewRequestedRow!.cache_hit_rate).toBe(0.75);
    expect(reviewRequestedRow!.skipped_queries).toBe(0);
    expect(reviewRequestedRow!.retry_attempts).toBe(1);
    expect(reviewRequestedRow!.degradation_path).toBe("none");
    expect(reviewRequestedRow!.created_at).toBeTruthy();
    expect(openedRow!.event_type).toBe("pull_request.opened");
    expect(openedRow!.cache_hit_rate).toBe(0);
    expect(openedRow!.skipped_queries).toBe(1);
    expect(openedRow!.retry_attempts).toBe(1);
    expect(openedRow!.degradation_path).toBe("search-api-rate-limit");
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

    expect(Number(count!.cnt)).toBe(1);
    expect(row!.cache_hit_rate).toBe(0);
    expect(row!.skipped_queries).toBe(1);
    expect(row!.retry_attempts).toBe(1);
    expect(row!.degradation_path).toBe("search-api-rate-limit");
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

    expect(Number(count!.cnt)).toBe(0);
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

    expect(Number(count!.cnt)).toBe(0);
  });
});
