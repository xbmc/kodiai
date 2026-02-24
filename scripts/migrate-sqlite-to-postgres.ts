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

async function batchInsert<T extends Record<string, unknown>>(
  rows: T[],
  insertFn: (batch: T[]) => Promise<void>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (!dryRun) {
      await insertFn(batch);
    }
    total += batch.length;
  }
  return total;
}

// ── Knowledge DB Migration ──────────────────────────────────────────────────

async function migrateKnowledgeDb(): Promise<void> {
  console.log("=== Migrating Knowledge DB ===");
  const db = openSqlite(knowledgeDbPath);
  if (!db) return;

  try {
    // Reviews
    if (tableExists(db, "reviews")) {
      const reviews = db.query("SELECT * FROM reviews").all() as Record<string, unknown>[];
      const count = await batchInsert(reviews, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO reviews (id, created_at, repo, pr_number, head_sha, delivery_id, files_analyzed, lines_changed, findings_critical, findings_major, findings_medium, findings_minor, findings_total, suppressions_applied, config_snapshot, duration_ms, model, conclusion)
               VALUES ($1, COALESCE(to_timestamp($2::text, 'YYYY-MM-DD HH24:MI:SS'), now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
               ON CONFLICT DO NOTHING`,
              [r.id, r.created_at, r.repo, r.pr_number, r.head_sha, r.delivery_id, r.files_analyzed ?? 0, r.lines_changed ?? 0, r.findings_critical ?? 0, r.findings_major ?? 0, r.findings_medium ?? 0, r.findings_minor ?? 0, r.findings_total ?? 0, r.suppressions_applied ?? 0, r.config_snapshot, r.duration_ms, r.model, r.conclusion ?? "unknown"],
            );
          }
        });
      });
      console.log(`  reviews: ${count} rows`);
    }

    // Findings
    if (tableExists(db, "findings")) {
      const findings = db.query("SELECT * FROM findings").all() as Record<string, unknown>[];
      const count = await batchInsert(findings, async (batch) => {
        await sql.begin(async (tx) => {
          for (const f of batch) {
            await tx.unsafe(
              `INSERT INTO findings (id, review_id, created_at, file_path, start_line, end_line, severity, category, confidence, title, suppressed, suppression_pattern, comment_id, comment_surface, review_output_key)
               VALUES ($1, $2, COALESCE(to_timestamp($3::text, 'YYYY-MM-DD HH24:MI:SS'), now()), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
               ON CONFLICT DO NOTHING`,
              [f.id, f.review_id, f.created_at, f.file_path, f.start_line, f.end_line, f.severity, f.category, f.confidence, f.title, Boolean(f.suppressed), f.suppression_pattern, f.comment_id, f.comment_surface, f.review_output_key],
            );
          }
        });
      });
      console.log(`  findings: ${count} rows`);
    }

    // Suppression log
    if (tableExists(db, "suppression_log")) {
      const rows = db.query("SELECT * FROM suppression_log").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO suppression_log (id, review_id, pattern, matched_count, finding_ids)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT DO NOTHING`,
              [r.id, r.review_id, r.pattern, r.matched_count, r.finding_ids],
            );
          }
        });
      });
      console.log(`  suppression_log: ${count} rows`);
    }

    // Global patterns
    if (tableExists(db, "global_patterns")) {
      const rows = db.query("SELECT * FROM global_patterns").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO global_patterns (severity, category, confidence_band, pattern_fingerprint, count)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (severity, category, confidence_band, pattern_fingerprint)
               DO UPDATE SET count = global_patterns.count + EXCLUDED.count`,
              [r.severity, r.category, r.confidence_band, r.pattern_fingerprint, r.count],
            );
          }
        });
      });
      console.log(`  global_patterns: ${count} rows`);
    }

    // Feedback reactions
    if (tableExists(db, "feedback_reactions")) {
      const rows = db.query("SELECT * FROM feedback_reactions").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO feedback_reactions (repo, review_id, finding_id, comment_id, comment_surface, reaction_id, reaction_content, reactor_login, reacted_at, severity, category, file_path, title)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE(to_timestamp($9::text, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), null), $10, $11, $12, $13)
               ON CONFLICT (repo, comment_id, reaction_id) DO NOTHING`,
              [r.repo, r.review_id, r.finding_id, r.comment_id, r.comment_surface, r.reaction_id, r.reaction_content, r.reactor_login, r.reacted_at, r.severity, r.category, r.file_path, r.title],
            );
          }
        });
      });
      console.log(`  feedback_reactions: ${count} rows`);
    }

    // Run state
    if (tableExists(db, "run_state")) {
      const rows = db.query("SELECT * FROM run_state").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO run_state (run_key, repo, pr_number, base_sha, head_sha, delivery_id, action, status, created_at, completed_at, superseded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE(to_timestamp($9::text, 'YYYY-MM-DD HH24:MI:SS'), now()), CASE WHEN $10::text IS NOT NULL THEN to_timestamp($10::text, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END, $11)
               ON CONFLICT (run_key) DO NOTHING`,
              [r.run_key, r.repo, r.pr_number, r.base_sha, r.head_sha, r.delivery_id, r.action, r.status, r.created_at, r.completed_at, r.superseded_by],
            );
          }
        });
      });
      console.log(`  run_state: ${count} rows`);
    }

    // Author cache
    if (tableExists(db, "author_cache")) {
      const rows = db.query("SELECT * FROM author_cache").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO author_cache (repo, author_login, tier, author_association, pr_count, cached_at)
               VALUES ($1, $2, $3, $4, $5, COALESCE(to_timestamp($6::text, 'YYYY-MM-DD HH24:MI:SS'), now()))
               ON CONFLICT (repo, author_login) DO NOTHING`,
              [r.repo, r.author_login, r.tier, r.author_association, r.pr_count, r.cached_at],
            );
          }
        });
      });
      console.log(`  author_cache: ${count} rows`);
    }

    // Dep bump merge history
    if (tableExists(db, "dep_bump_merge_history")) {
      const rows = db.query("SELECT * FROM dep_bump_merge_history").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO dep_bump_merge_history (repo, pr_number, merged_at, delivery_id, source, signals_json, package_name, old_version, new_version, semver_bump_type, merge_confidence_level, merge_confidence_rationale_json, advisory_status, advisory_max_severity, is_security_bump)
               VALUES ($1, $2, CASE WHEN $3::text IS NOT NULL THEN to_timestamp($3::text, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
               ON CONFLICT (repo, pr_number) DO NOTHING`,
              [r.repo, r.pr_number, r.merged_at, r.delivery_id, r.source, r.signals_json, r.package_name, r.old_version, r.new_version, r.semver_bump_type, r.merge_confidence_level, r.merge_confidence_rationale_json, r.advisory_status, r.advisory_max_severity, r.is_security_bump != null ? Boolean(r.is_security_bump) : null],
            );
          }
        });
      });
      console.log(`  dep_bump_merge_history: ${count} rows`);
    }

    // Review checkpoints
    if (tableExists(db, "review_checkpoints")) {
      const rows = db.query("SELECT * FROM review_checkpoints").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO review_checkpoints (review_output_key, repo, pr_number, checkpoint_data, partial_comment_id)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (review_output_key) DO NOTHING`,
              [r.review_output_key, r.repo, r.pr_number, r.checkpoint_data, r.partial_comment_id],
            );
          }
        });
      });
      console.log(`  review_checkpoints: ${count} rows`);
    }

    // Learning memories (with vector data from sqlite-vec)
    if (tableExists(db, "learning_memories")) {
      const memories = db.query("SELECT * FROM learning_memories").all() as Record<string, unknown>[];

      // Try to join with vector table if it exists
      let vectorMap = new Map<number, Float32Array>();
      if (tableExists(db, "learning_memory_vec")) {
        try {
          const vecRows = db.query("SELECT rowid, vec FROM learning_memory_vec").all() as { rowid: number; vec: Uint8Array }[];
          for (const v of vecRows) {
            if (v.vec && v.vec.byteLength > 0) {
              vectorMap.set(v.rowid, new Float32Array(v.vec.buffer, v.vec.byteOffset, v.vec.byteLength / 4));
            }
          }
        } catch (err) {
          console.warn(`  WARNING: Could not read learning_memory_vec: ${err}`);
        }
      }

      const count = await batchInsert(memories, async (batch) => {
        await sql.begin(async (tx) => {
          for (const m of batch) {
            const embedding = vectorMap.get(m.id as number);
            const vectorStr = embedding
              ? `[${Array.from(embedding).join(",")}]`
              : null;

            await tx.unsafe(
              `INSERT INTO learning_memories (repo, owner, finding_id, review_id, source_repo, finding_text, severity, category, file_path, outcome, embedding_model, embedding_dim, embedding, stale, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ${vectorStr ? `$13::vector` : "NULL"}, $14, COALESCE(to_timestamp($15::text, 'YYYY-MM-DD HH24:MI:SS'), now()))
               ON CONFLICT (repo, finding_id, outcome) DO NOTHING`,
              [m.repo, m.owner, m.finding_id, m.review_id, m.source_repo, m.finding_text, m.severity, m.category, m.file_path, m.outcome, m.embedding_model, m.embedding_dim, ...(vectorStr ? [vectorStr] : []), Boolean(m.stale), m.created_at],
            );
          }
        });
      });
      console.log(`  learning_memories: ${count} rows (${vectorMap.size} with embeddings)`);
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
      const rows = db.query(`SELECT * FROM ${sourceTable}`).all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO telemetry_events (created_at, delivery_id, repo, pr_number, pr_author, event_type, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason)
               VALUES (COALESCE(to_timestamp($1::text, 'YYYY-MM-DD HH24:MI:SS'), now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
               ON CONFLICT DO NOTHING`,
              [r.created_at, r.delivery_id, r.repo, r.pr_number, r.pr_author ?? r.prAuthor, r.event_type ?? r.eventType, r.provider ?? "anthropic", r.model, r.input_tokens ?? r.inputTokens ?? 0, r.output_tokens ?? r.outputTokens ?? 0, r.cache_read_tokens ?? r.cacheReadTokens ?? 0, r.cache_creation_tokens ?? r.cacheCreationTokens ?? 0, r.duration_ms ?? r.durationMs ?? 0, r.cost_usd ?? r.costUsd ?? 0, r.conclusion, r.session_id ?? r.sessionId, r.num_turns ?? r.numTurns, r.stop_reason ?? r.stopReason],
            );
          }
        });
      });
      console.log(`  telemetry_events (from ${sourceTable}): ${count} rows`);
    }

    // Rate limit events
    if (tableExists(db, "rate_limit_events")) {
      const rows = db.query("SELECT * FROM rate_limit_events").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO rate_limit_events (created_at, delivery_id, repo, pr_number, event_type, cache_hit_rate, skipped_queries, retry_attempts, degradation_path)
               VALUES (COALESCE(to_timestamp($1::text, 'YYYY-MM-DD HH24:MI:SS'), now()), $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT DO NOTHING`,
              [r.created_at, r.delivery_id, r.repo, r.pr_number, r.event_type, r.cache_hit_rate ?? r.cacheHitRate, r.skipped_queries ?? r.skippedQueries, r.retry_attempts ?? r.retryAttempts, r.degradation_path ?? r.degradationPath],
            );
          }
        });
      });
      console.log(`  rate_limit_events: ${count} rows`);
    }

    // Retrieval quality events
    const rqTable = tableExists(db, "retrieval_quality") ? "retrieval_quality" : tableExists(db, "retrieval_quality_events") ? "retrieval_quality_events" : null;
    if (rqTable) {
      const rows = db.query(`SELECT * FROM ${rqTable}`).all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO retrieval_quality_events (created_at, delivery_id, repo, pr_number, event_type, top_k, distance_threshold, result_count, avg_distance, language_match_ratio, threshold_method)
               VALUES (COALESCE(to_timestamp($1::text, 'YYYY-MM-DD HH24:MI:SS'), now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT DO NOTHING`,
              [r.created_at, r.delivery_id, r.repo, r.pr_number, r.event_type, r.top_k ?? r.topK, r.distance_threshold ?? r.distanceThreshold, r.result_count ?? r.resultCount, r.avg_distance ?? r.avgDistance, r.language_match_ratio ?? r.languageMatchRatio, r.threshold_method ?? r.thresholdMethod],
            );
          }
        });
      });
      console.log(`  retrieval_quality_events (from ${rqTable}): ${count} rows`);
    }

    // Resilience events
    if (tableExists(db, "resilience_events")) {
      const rows = db.query("SELECT * FROM resilience_events").all() as Record<string, unknown>[];
      const count = await batchInsert(rows, async (batch) => {
        await sql.begin(async (tx) => {
          for (const r of batch) {
            await tx.unsafe(
              `INSERT INTO resilience_events (created_at, delivery_id, repo, pr_number, pr_author, event_type, kind, parent_delivery_id, review_output_key, execution_conclusion, had_inline_output, checkpoint_files_reviewed, checkpoint_finding_count, checkpoint_total_files, partial_comment_id, recent_timeouts, chronic_timeout, retry_enqueued, retry_files_count, retry_scope_ratio, retry_timeout_seconds, retry_risk_level, retry_checkpoint_enabled, retry_has_results)
               VALUES (COALESCE(to_timestamp($1::text, 'YYYY-MM-DD HH24:MI:SS'), now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
               ON CONFLICT (delivery_id) DO NOTHING`,
              [r.created_at, r.delivery_id, r.repo, r.pr_number, r.pr_author, r.event_type, r.kind, r.parent_delivery_id, r.review_output_key, r.execution_conclusion, r.had_inline_output != null ? Boolean(r.had_inline_output) : null, r.checkpoint_files_reviewed, r.checkpoint_finding_count, r.checkpoint_total_files, r.partial_comment_id, r.recent_timeouts, r.chronic_timeout != null ? Boolean(r.chronic_timeout) : null, r.retry_enqueued != null ? Boolean(r.retry_enqueued) : null, r.retry_files_count, r.retry_scope_ratio, r.retry_timeout_seconds, r.retry_risk_level, r.retry_checkpoint_enabled != null ? Boolean(r.retry_checkpoint_enabled) : null, r.retry_has_results != null ? Boolean(r.retry_has_results) : null],
            );
          }
        });
      });
      console.log(`  resilience_events: ${count} rows`);
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
