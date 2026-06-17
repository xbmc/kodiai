// @ts-nocheck -- One-time migration script with dynamic SQLite row data
/**
 * One-time migration script: SQLite -> PostgreSQL
 *
 * Reads from local SQLite knowledge and telemetry databases and writes
 * to PostgreSQL (via DATABASE_URL). This is a one-time data transfer tool,
 * NOT part of the application runtime.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun scripts/migrate-sqlite-to-postgres.ts
 *   DATABASE_URL=postgresql://... bun scripts/migrate-sqlite-to-postgres.ts --knowledge-db ./data/kodiai-knowledge.db --telemetry-db ./data/kodiai-telemetry.db
 */

import { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { batchInsertFromSqliteQuery } from "./sqlite-batch.ts";

const logger = pino({ level: "info" });

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "knowledge-db": { type: "string", default: "./data/kodiai-knowledge.db" },
    "telemetry-db": { type: "string", default: "./data/kodiai-telemetry.db" },
    "dry-run": { type: "boolean", default: false },
  },
});

const knowledgeDbPath = values["knowledge-db"]!;
const telemetryDbPath = values["telemetry-db"]!;
const dryRun = values["dry-run"]!;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

console.log(`Knowledge DB: ${knowledgeDbPath}`);
console.log(`Telemetry DB: ${telemetryDbPath}`);
console.log(`PostgreSQL:   ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
if (dryRun) console.log("DRY RUN: No data will be written.");
console.log();

const { sql, close } = createDbClient({ logger });

// Ensure PostgreSQL schema is up to date
await runMigrations(sql);

const BATCH_SIZE = 100;

// ── Helpers ─────────────────────────────────────────────────────────────────

function openSqlite(path: string): Database | null {
  try {
    const db = new Database(path, { readonly: true });
    return db;
  } catch (err) {
    console.warn(`  WARNING: Could not open ${path}: ${err}`);
    return null;
  }
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as { name: string } | null;
  return row !== null;
}

async function migrateSqliteRows<T extends Record<string, unknown>>(
  db: Database,
  selectSql: string,
  insertFn: (batch: T[]) => Promise<void>,
): Promise<number> {
  return batchInsertFromSqliteQuery<T>(db, selectSql, BATCH_SIZE, async (batch) => {
    if (!dryRun) {
      await insertFn(batch);
    }
  });
}

async function insertJsonbRows(
  tx: { unsafe: (query: string, params?: unknown[]) => Promise<unknown> },
  rows: Array<Record<string, unknown>>,
  query: string,
): Promise<void> {
  if (rows.length === 0) return;
  await tx.unsafe(query, [JSON.stringify(rows)]);
}

type JsonbMigrationDescriptor<T extends Record<string, unknown>> = {
  label: string;
  selectSql: string;
  mapRow: (row: T) => Record<string, unknown>;
  insertSql: string;
};

async function migrateJsonbRows<T extends Record<string, unknown>>(
  db: Database,
  descriptor: JsonbMigrationDescriptor<T>,
): Promise<number> {
  const count = await migrateSqliteRows<T>(db, descriptor.selectSql, async (batch) => {
    await sql.begin(async (tx) => {
      await insertJsonbRows(tx, batch.map(descriptor.mapRow), descriptor.insertSql);
    });
  });
  console.log(`  ${descriptor.label}: ${count} rows`);
  return count;
}

function sqliteVectorToPostgres(value: unknown): string | null {
  const vec = value as Uint8Array | null | undefined;
  if (!vec || vec.byteLength === 0) return null;
  const embedding = new Float32Array(vec.buffer, vec.byteOffset, vec.byteLength / 4);
  return `[${Array.from(embedding).join(",")}]`;
}

// ── Knowledge DB Migration ──────────────────────────────────────────────────

async function migrateKnowledgeDb(): Promise<void> {
  console.log("=== Migrating Knowledge DB ===");
  const db = openSqlite(knowledgeDbPath);
  if (!db) return;

  try {
    // Reviews
    if (tableExists(db, "reviews")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "reviews",
        selectSql: "SELECT * FROM reviews",
        mapRow: (r) => ({
          id: r.id,
          created_at: r.created_at,
          repo: r.repo,
          pr_number: r.pr_number,
          head_sha: r.head_sha,
          delivery_id: r.delivery_id,
          files_analyzed: r.files_analyzed ?? 0,
          lines_changed: r.lines_changed ?? 0,
          findings_critical: r.findings_critical ?? 0,
          findings_major: r.findings_major ?? 0,
          findings_medium: r.findings_medium ?? 0,
          findings_minor: r.findings_minor ?? 0,
          findings_total: r.findings_total ?? 0,
          suppressions_applied: r.suppressions_applied ?? 0,
          config_snapshot: r.config_snapshot,
          duration_ms: r.duration_ms,
          model: r.model,
          conclusion: r.conclusion ?? "unknown",
        }),
        insertSql: `
            INSERT INTO reviews (id, created_at, repo, pr_number, head_sha, delivery_id, files_analyzed, lines_changed, findings_critical, findings_major, findings_medium, findings_minor, findings_total, suppressions_applied, config_snapshot, duration_ms, model, conclusion)
            SELECT id, COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), repo, pr_number, head_sha, delivery_id, files_analyzed, lines_changed, findings_critical, findings_major, findings_medium, findings_minor, findings_total, suppressions_applied, config_snapshot, duration_ms, model, conclusion
            FROM jsonb_to_recordset($1::jsonb) AS r (id integer, created_at text, repo text, pr_number integer, head_sha text, delivery_id text, files_analyzed integer, lines_changed integer, findings_critical integer, findings_major integer, findings_medium integer, findings_minor integer, findings_total integer, suppressions_applied integer, config_snapshot text, duration_ms integer, model text, conclusion text)
            ON CONFLICT DO NOTHING
          `,
      });
    }

    // Findings
    if (tableExists(db, "findings")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "findings",
        selectSql: "SELECT * FROM findings",
        mapRow: (f) => ({
          id: f.id,
          review_id: f.review_id,
          created_at: f.created_at,
          file_path: f.file_path,
          start_line: f.start_line,
          end_line: f.end_line,
          severity: f.severity,
          category: f.category,
          confidence: f.confidence,
          title: f.title,
          suppressed: Boolean(f.suppressed),
          suppression_pattern: f.suppression_pattern,
          comment_id: f.comment_id,
          comment_surface: f.comment_surface,
          review_output_key: f.review_output_key,
        }),
        insertSql: `
            INSERT INTO findings (id, review_id, created_at, file_path, start_line, end_line, severity, category, confidence, title, suppressed, suppression_pattern, comment_id, comment_surface, review_output_key)
            SELECT id, review_id, COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), file_path, start_line, end_line, severity, category, confidence, title, suppressed, suppression_pattern, comment_id, comment_surface, review_output_key
            FROM jsonb_to_recordset($1::jsonb) AS r (id integer, review_id integer, created_at text, file_path text, start_line integer, end_line integer, severity text, category text, confidence integer, title text, suppressed boolean, suppression_pattern text, comment_id integer, comment_surface text, review_output_key text)
            ON CONFLICT DO NOTHING
          `,
      });
    }

    // Suppression log
    if (tableExists(db, "suppression_log")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "suppression_log",
        selectSql: "SELECT * FROM suppression_log",
        mapRow: (r) => ({
          id: r.id,
          review_id: r.review_id,
          pattern: r.pattern,
          matched_count: r.matched_count,
          finding_ids: r.finding_ids,
        }),
        insertSql: `
            INSERT INTO suppression_log (id, review_id, pattern, matched_count, finding_ids)
            SELECT id, review_id, pattern, matched_count, finding_ids
            FROM jsonb_to_recordset($1::jsonb) AS r (id integer, review_id integer, pattern text, matched_count integer, finding_ids text)
            ON CONFLICT DO NOTHING
          `,
      });
    }

    // Global patterns
    if (tableExists(db, "global_patterns")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "global_patterns",
        selectSql: "SELECT * FROM global_patterns",
        mapRow: (r) => ({
          severity: r.severity,
          category: r.category,
          confidence_band: r.confidence_band,
          pattern_fingerprint: r.pattern_fingerprint,
          count: r.count,
        }),
        insertSql: `
            INSERT INTO global_patterns (severity, category, confidence_band, pattern_fingerprint, count)
            SELECT severity, category, confidence_band, pattern_fingerprint, count
            FROM jsonb_to_recordset($1::jsonb) AS r (severity text, category text, confidence_band text, pattern_fingerprint text, count integer)
            ON CONFLICT (severity, category, confidence_band, pattern_fingerprint)
            DO UPDATE SET count = global_patterns.count + EXCLUDED.count
          `,
      });
    }

    // Feedback reactions
    if (tableExists(db, "feedback_reactions")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "feedback_reactions",
        selectSql: "SELECT * FROM feedback_reactions",
        mapRow: (r) => ({
          repo: r.repo,
          review_id: r.review_id,
          finding_id: r.finding_id,
          comment_id: r.comment_id,
          comment_surface: r.comment_surface,
          reaction_id: r.reaction_id,
          reaction_content: r.reaction_content,
          reactor_login: r.reactor_login,
          reacted_at: r.reacted_at,
          severity: r.severity,
          category: r.category,
          file_path: r.file_path,
          title: r.title,
        }),
        insertSql: `
            INSERT INTO feedback_reactions (repo, review_id, finding_id, comment_id, comment_surface, reaction_id, reaction_content, reactor_login, reacted_at, severity, category, file_path, title)
            SELECT repo, review_id, finding_id, comment_id, comment_surface, reaction_id, reaction_content, reactor_login, to_timestamp(reacted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), severity, category, file_path, title
            FROM jsonb_to_recordset($1::jsonb) AS r (repo text, review_id integer, finding_id integer, comment_id integer, comment_surface text, reaction_id integer, reaction_content text, reactor_login text, reacted_at text, severity text, category text, file_path text, title text)
            ON CONFLICT (repo, comment_id, reaction_id) DO NOTHING
          `,
      });
    }

    // Run state
    if (tableExists(db, "run_state")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "run_state",
        selectSql: "SELECT * FROM run_state",
        mapRow: (r) => ({
          run_key: r.run_key,
          repo: r.repo,
          pr_number: r.pr_number,
          base_sha: r.base_sha,
          head_sha: r.head_sha,
          delivery_id: r.delivery_id,
          action: r.action,
          status: r.status,
          created_at: r.created_at,
          completed_at: r.completed_at,
          superseded_by: r.superseded_by,
        }),
        insertSql: `
            INSERT INTO run_state (run_key, repo, pr_number, base_sha, head_sha, delivery_id, action, status, created_at, completed_at, superseded_by)
            SELECT run_key, repo, pr_number, base_sha, head_sha, delivery_id, action, status, COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), CASE WHEN completed_at IS NOT NULL THEN to_timestamp(completed_at, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END, superseded_by
            FROM jsonb_to_recordset($1::jsonb) AS r (run_key text, repo text, pr_number integer, base_sha text, head_sha text, delivery_id text, action text, status text, created_at text, completed_at text, superseded_by text)
            ON CONFLICT (run_key) DO NOTHING
          `,
      });
    }

    // Author cache
    if (tableExists(db, "author_cache")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "author_cache",
        selectSql: "SELECT * FROM author_cache",
        mapRow: (r) => ({
          repo: r.repo,
          author_login: r.author_login,
          tier: r.tier,
          author_association: r.author_association,
          pr_count: r.pr_count,
          cached_at: r.cached_at,
        }),
        insertSql: `
            INSERT INTO author_cache (repo, author_login, tier, author_association, pr_count, cached_at)
            SELECT repo, author_login, tier, author_association, pr_count, COALESCE(to_timestamp(cached_at, 'YYYY-MM-DD HH24:MI:SS'), now())
            FROM jsonb_to_recordset($1::jsonb) AS r (repo text, author_login text, tier text, author_association text, pr_count integer, cached_at text)
            ON CONFLICT (repo, author_login) DO NOTHING
          `,
      });
    }

    // Dep bump merge history
    if (tableExists(db, "dep_bump_merge_history")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "dep_bump_merge_history",
        selectSql: "SELECT * FROM dep_bump_merge_history",
        mapRow: (r) => ({
          repo: r.repo,
          pr_number: r.pr_number,
          merged_at: r.merged_at,
          delivery_id: r.delivery_id,
          source: r.source,
          signals_json: r.signals_json,
          package_name: r.package_name,
          old_version: r.old_version,
          new_version: r.new_version,
          semver_bump_type: r.semver_bump_type,
          merge_confidence_level: r.merge_confidence_level,
          merge_confidence_rationale_json: r.merge_confidence_rationale_json,
          advisory_status: r.advisory_status,
          advisory_max_severity: r.advisory_max_severity,
          is_security_bump: r.is_security_bump != null ? Boolean(r.is_security_bump) : null,
        }),
        insertSql: `
            INSERT INTO dep_bump_merge_history (repo, pr_number, merged_at, delivery_id, source, signals_json, package_name, old_version, new_version, semver_bump_type, merge_confidence_level, merge_confidence_rationale_json, advisory_status, advisory_max_severity, is_security_bump)
            SELECT repo, pr_number, CASE WHEN merged_at IS NOT NULL THEN to_timestamp(merged_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END, delivery_id, source, signals_json, package_name, old_version, new_version, semver_bump_type, merge_confidence_level, merge_confidence_rationale_json, advisory_status, advisory_max_severity, is_security_bump
            FROM jsonb_to_recordset($1::jsonb) AS r (repo text, pr_number integer, merged_at text, delivery_id text, source text, signals_json text, package_name text, old_version text, new_version text, semver_bump_type text, merge_confidence_level text, merge_confidence_rationale_json text, advisory_status text, advisory_max_severity text, is_security_bump boolean)
            ON CONFLICT (repo, pr_number) DO NOTHING
          `,
      });
    }

    // Review checkpoints
    if (tableExists(db, "review_checkpoints")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "review_checkpoints",
        selectSql: "SELECT * FROM review_checkpoints",
        mapRow: (r) => ({
          review_output_key: r.review_output_key,
          repo: r.repo,
          pr_number: r.pr_number,
          checkpoint_data: r.checkpoint_data,
          partial_comment_id: r.partial_comment_id,
        }),
        insertSql: `
            INSERT INTO review_checkpoints (review_output_key, repo, pr_number, checkpoint_data, partial_comment_id)
            SELECT review_output_key, repo, pr_number, checkpoint_data, partial_comment_id
            FROM jsonb_to_recordset($1::jsonb) AS r (review_output_key text, repo text, pr_number integer, checkpoint_data text, partial_comment_id integer)
            ON CONFLICT (review_output_key) DO NOTHING
          `,
      });
    }

    // Learning memories (with vector data from sqlite-vec)
    if (tableExists(db, "learning_memories")) {
      const memorySelect = tableExists(db, "learning_memory_vec")
        ? "SELECT m.*, v.vec AS embedding_vec FROM learning_memories m LEFT JOIN learning_memory_vec v ON v.rowid = m.id"
        : "SELECT m.*, NULL AS embedding_vec FROM learning_memories m";

      let embeddedCount = 0;
      const count = await migrateSqliteRows<Record<string, unknown>>(db, memorySelect, async (batch) => {
        await sql.begin(async (tx) => {
          const rows = batch.map((m) => {
            const embedding = sqliteVectorToPostgres(m.embedding_vec);
            if (embedding) {
              embeddedCount++;
            }
            return {
              repo: m.repo,
              owner: m.owner,
              finding_id: m.finding_id,
              review_id: m.review_id,
              source_repo: m.source_repo,
              finding_text: m.finding_text,
              severity: m.severity,
              category: m.category,
              file_path: m.file_path,
              outcome: m.outcome,
              embedding_model: m.embedding_model,
              embedding_dim: m.embedding_dim,
              embedding,
              stale: Boolean(m.stale),
              created_at: m.created_at,
            };
          });
          await insertJsonbRows(tx, rows, `
            INSERT INTO learning_memories (repo, owner, finding_id, review_id, source_repo, finding_text, severity, category, file_path, outcome, embedding_model, embedding_dim, embedding, stale, created_at)
            SELECT repo, owner, finding_id, review_id, source_repo, finding_text, severity, category, file_path, outcome, embedding_model, embedding_dim, CASE WHEN embedding IS NULL THEN NULL ELSE embedding::vector END, stale, COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now())
            FROM jsonb_to_recordset($1::jsonb) AS r (repo text, owner text, finding_id bigint, review_id integer, source_repo text, finding_text text, severity text, category text, file_path text, outcome text, embedding_model text, embedding_dim integer, embedding text, stale boolean, created_at text)
            ON CONFLICT (repo, finding_id, outcome) DO NOTHING
          `);
        });
      });
      console.log(`  learning_memories: ${count} rows (${embeddedCount} with embeddings)`);
    }
  } finally {
    db.close();
  }
}

// ── Telemetry DB Migration ──────────────────────────────────────────────────

async function migrateTelemetryDb(): Promise<void> {
  console.log("\n=== Migrating Telemetry DB ===");
  const db = openSqlite(telemetryDbPath);
  if (!db) return;

  try {
    // Telemetry events (executions -> telemetry_events)
    const sourceTable = tableExists(db, "executions") ? "executions" : tableExists(db, "telemetry_events") ? "telemetry_events" : null;
    if (sourceTable) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: `telemetry_events (from ${sourceTable})`,
        selectSql: `SELECT * FROM ${sourceTable}`,
        mapRow: (r) => ({
          created_at: r.created_at,
          delivery_id: r.delivery_id,
          repo: r.repo,
          pr_number: r.pr_number,
          pr_author: r.pr_author ?? r.prAuthor,
          event_type: r.event_type ?? r.eventType,
          provider: r.provider ?? "anthropic",
          model: r.model,
          input_tokens: r.input_tokens ?? r.inputTokens ?? 0,
          output_tokens: r.output_tokens ?? r.outputTokens ?? 0,
          cache_read_tokens: r.cache_read_tokens ?? r.cacheReadTokens ?? 0,
          cache_creation_tokens: r.cache_creation_tokens ?? r.cacheCreationTokens ?? 0,
          duration_ms: r.duration_ms ?? r.durationMs ?? 0,
          cost_usd: r.cost_usd ?? r.costUsd ?? 0,
          conclusion: r.conclusion,
          session_id: r.session_id ?? r.sessionId,
          num_turns: r.num_turns ?? r.numTurns,
          stop_reason: r.stop_reason ?? r.stopReason,
        }),
        insertSql: `
            INSERT INTO telemetry_events (created_at, delivery_id, repo, pr_number, pr_author, event_type, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason)
            SELECT COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), delivery_id, repo, pr_number, pr_author, event_type, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason
            FROM jsonb_to_recordset($1::jsonb) AS r (created_at text, delivery_id text, repo text, pr_number integer, pr_author text, event_type text, provider text, model text, input_tokens integer, output_tokens integer, cache_read_tokens integer, cache_creation_tokens integer, duration_ms integer, cost_usd real, conclusion text, session_id text, num_turns integer, stop_reason text)
            ON CONFLICT DO NOTHING
          `,
      });
    }

    // Rate limit events
    if (tableExists(db, "rate_limit_events")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "rate_limit_events",
        selectSql: "SELECT * FROM rate_limit_events",
        mapRow: (r) => ({
          created_at: r.created_at,
          delivery_id: r.delivery_id,
          repo: r.repo,
          pr_number: r.pr_number,
          event_type: r.event_type,
          cache_hit_rate: r.cache_hit_rate ?? r.cacheHitRate,
          skipped_queries: r.skipped_queries ?? r.skippedQueries,
          retry_attempts: r.retry_attempts ?? r.retryAttempts,
          degradation_path: r.degradation_path ?? r.degradationPath,
        }),
        insertSql: `
            INSERT INTO rate_limit_events (created_at, delivery_id, repo, pr_number, event_type, cache_hit_rate, skipped_queries, retry_attempts, degradation_path)
            SELECT COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), delivery_id, repo, pr_number, event_type, cache_hit_rate, skipped_queries, retry_attempts, degradation_path
            FROM jsonb_to_recordset($1::jsonb) AS r (created_at text, delivery_id text, repo text, pr_number integer, event_type text, cache_hit_rate real, skipped_queries integer, retry_attempts integer, degradation_path text)
            ON CONFLICT DO NOTHING
          `,
      });
    }

    // Retrieval quality events
    const rqTable = tableExists(db, "retrieval_quality") ? "retrieval_quality" : tableExists(db, "retrieval_quality_events") ? "retrieval_quality_events" : null;
    if (rqTable) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: `retrieval_quality_events (from ${rqTable})`,
        selectSql: `SELECT * FROM ${rqTable}`,
        mapRow: (r) => ({
          created_at: r.created_at,
          delivery_id: r.delivery_id,
          repo: r.repo,
          pr_number: r.pr_number,
          event_type: r.event_type,
          top_k: r.top_k ?? r.topK,
          distance_threshold: r.distance_threshold ?? r.distanceThreshold,
          result_count: r.result_count ?? r.resultCount,
          avg_distance: r.avg_distance ?? r.avgDistance,
          language_match_ratio: r.language_match_ratio ?? r.languageMatchRatio,
          threshold_method: r.threshold_method ?? r.thresholdMethod,
        }),
        insertSql: `
            INSERT INTO retrieval_quality_events (created_at, delivery_id, repo, pr_number, event_type, top_k, distance_threshold, result_count, avg_distance, language_match_ratio, threshold_method)
            SELECT COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), delivery_id, repo, pr_number, event_type, top_k, distance_threshold, result_count, avg_distance, language_match_ratio, threshold_method
            FROM jsonb_to_recordset($1::jsonb) AS r (created_at text, delivery_id text, repo text, pr_number integer, event_type text, top_k integer, distance_threshold real, result_count integer, avg_distance real, language_match_ratio real, threshold_method text)
            ON CONFLICT DO NOTHING
          `,
      });
    }

    // Resilience events
    if (tableExists(db, "resilience_events")) {
      await migrateJsonbRows<Record<string, unknown>>(db, {
        label: "resilience_events",
        selectSql: "SELECT * FROM resilience_events",
        mapRow: (r) => ({
          created_at: r.created_at,
          delivery_id: r.delivery_id,
          repo: r.repo,
          pr_number: r.pr_number,
          pr_author: r.pr_author,
          event_type: r.event_type,
          kind: r.kind,
          parent_delivery_id: r.parent_delivery_id,
          review_output_key: r.review_output_key,
          execution_conclusion: r.execution_conclusion,
          had_inline_output: r.had_inline_output != null ? Boolean(r.had_inline_output) : null,
          checkpoint_files_reviewed: r.checkpoint_files_reviewed,
          checkpoint_finding_count: r.checkpoint_finding_count,
          checkpoint_total_files: r.checkpoint_total_files,
          partial_comment_id: r.partial_comment_id,
          recent_timeouts: r.recent_timeouts,
          chronic_timeout: r.chronic_timeout != null ? Boolean(r.chronic_timeout) : null,
          retry_enqueued: r.retry_enqueued != null ? Boolean(r.retry_enqueued) : null,
          retry_files_count: r.retry_files_count,
          retry_scope_ratio: r.retry_scope_ratio,
          retry_timeout_seconds: r.retry_timeout_seconds,
          retry_risk_level: r.retry_risk_level,
          retry_checkpoint_enabled: r.retry_checkpoint_enabled != null ? Boolean(r.retry_checkpoint_enabled) : null,
          retry_has_results: r.retry_has_results != null ? Boolean(r.retry_has_results) : null,
        }),
        insertSql: `
            INSERT INTO resilience_events (created_at, delivery_id, repo, pr_number, pr_author, event_type, kind, parent_delivery_id, review_output_key, execution_conclusion, had_inline_output, checkpoint_files_reviewed, checkpoint_finding_count, checkpoint_total_files, partial_comment_id, recent_timeouts, chronic_timeout, retry_enqueued, retry_files_count, retry_scope_ratio, retry_timeout_seconds, retry_risk_level, retry_checkpoint_enabled, retry_has_results)
            SELECT COALESCE(to_timestamp(created_at, 'YYYY-MM-DD HH24:MI:SS'), now()), delivery_id, repo, pr_number, pr_author, event_type, kind, parent_delivery_id, review_output_key, execution_conclusion, had_inline_output, checkpoint_files_reviewed, checkpoint_finding_count, checkpoint_total_files, partial_comment_id, recent_timeouts, chronic_timeout, retry_enqueued, retry_files_count, retry_scope_ratio, retry_timeout_seconds, retry_risk_level, retry_checkpoint_enabled, retry_has_results
            FROM jsonb_to_recordset($1::jsonb) AS r (created_at text, delivery_id text, repo text, pr_number integer, pr_author text, event_type text, kind text, parent_delivery_id text, review_output_key text, execution_conclusion text, had_inline_output boolean, checkpoint_files_reviewed integer, checkpoint_finding_count integer, checkpoint_total_files integer, partial_comment_id integer, recent_timeouts integer, chronic_timeout boolean, retry_enqueued boolean, retry_files_count integer, retry_scope_ratio real, retry_timeout_seconds integer, retry_risk_level text, retry_checkpoint_enabled boolean, retry_has_results boolean)
            ON CONFLICT (delivery_id) DO NOTHING
          `,
      });
    }
  } finally {
    db.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

try {
  await migrateKnowledgeDb();
  await migrateTelemetryDb();

  console.log("\nMigration complete!");
  if (dryRun) {
    console.log("(DRY RUN - no data was actually written)");
  }

  // Print PostgreSQL row counts for verification
  console.log("\n=== PostgreSQL Row Counts ===");
  const tables = [
    "reviews", "findings", "suppression_log", "global_patterns",
    "feedback_reactions", "run_state", "author_cache", "dep_bump_merge_history",
    "review_checkpoints", "telemetry_events", "rate_limit_events",
    "retrieval_quality_events", "resilience_events", "learning_memories",
  ];
  for (const table of tables) {
    const rows = await sql.unsafe(`SELECT COUNT(*) AS count FROM ${table}`);
    console.log(`  ${table}: ${rows[0]?.count ?? 0}`);
  }
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await close();
}
