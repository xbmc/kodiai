# Technology Stack: v0.3 Enhanced Config + Usage Telemetry

**Project:** Kodiai GitHub App
**Researched:** 2026-02-11
**Scope:** Incremental stack additions for v0.3 milestone only

## Current Stack (Verified in Codebase)

These are already installed and working. DO NOT change or re-evaluate.

| Technology | Installed Version | Purpose |
|------------|-------------------|---------|
| Bun | 1.3.8 | Runtime |
| Hono | ^4.11.8 | HTTP framework |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 | Agent execution |
| @octokit/rest | ^22.0.1 | GitHub API |
| @octokit/auth-app | ^8.2.0 | GitHub App auth |
| @modelcontextprotocol/sdk | ^1.26.0 | MCP servers |
| zod | ^4.3.6 | Schema validation |
| pino | ^10.3.0 | Structured logging |
| js-yaml | ^4.1.1 | YAML parsing |
| p-queue | ^9.1.0 | Job queue |
| picomatch | ^4.0.2 | Glob matching |

**Confidence: HIGH** -- Versions read directly from `/home/keith/src/kodiai/package.json` and verified with `bun -e` smoke tests.

---

## v0.3 Stack Additions

### 1. Telemetry Storage: `bun:sqlite` (built-in, zero dependencies)

| Attribute | Value |
|-----------|-------|
| Package | `bun:sqlite` (built into Bun runtime) |
| Install | None required |
| Import | `import { Database } from "bun:sqlite"` |
| API style | Synchronous, inspired by better-sqlite3 |

**Why `bun:sqlite`:**

- **Zero dependencies.** It ships with Bun. No npm install, no native compilation, no version drift.
- **Already verified working** on Bun 1.3.8 -- tested `CREATE TABLE`, `INSERT`, `SELECT`, `PRAGMA journal_mode = WAL` all succeed.
- **3-6x faster** than better-sqlite3 for reads (Bun's own benchmarks). For telemetry writes at the scale of a few dozen per day, performance is irrelevant, but the zero-config advantage is decisive.
- **Synchronous API** is appropriate here because telemetry writes are small (single row inserts) and happen after the main async work (Agent SDK execution) completes. No risk of blocking the event loop for meaningful time.
- **WAL mode** should be enabled at database creation for safe concurrent reads (CLI reporting script) while the server writes. Single-process + WAL is the ideal SQLite deployment model.

**What it replaces:** Nothing. The project currently has no persistent storage. Telemetry data (costUsd, numTurns, durationMs, sessionId) is logged via pino and lost after log rotation.

**Key API patterns for this use case:**

```typescript
import { Database } from "bun:sqlite";

// Create/open database file
const db = new Database("/data/kodiai-telemetry.sqlite");
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");

// Prepared statement (cached, reusable)
const insertExecution = db.prepare(`
  INSERT INTO executions (delivery_id, installation_id, owner, repo, pr_number,
    event_type, conclusion, cost_usd, num_turns, duration_ms, session_id, created_at)
  VALUES ($deliveryId, $installationId, $owner, $repo, $prNumber,
    $eventType, $conclusion, $costUsd, $numTurns, $durationMs, $sessionId, $createdAt)
`);

// Insert returns { lastInsertRowid, changes }
insertExecution.run({ ... });

// Query returns array of objects
const rows = db.query("SELECT * FROM executions WHERE owner = ?").all("myorg");

// Transactions for batch operations
const batchInsert = db.transaction((items) => {
  for (const item of items) insertExecution.run(item);
});
```

**Confidence: HIGH** -- API verified via Bun official docs and local smoke test.

**Alternatives considered and rejected:**

| Alternative | Why Rejected |
|-------------|-------------|
| JSON file append | No query capability for aggregations. No concurrent read safety. CLI reporting would need to parse/re-parse entire file. |
| better-sqlite3 | Requires native compilation (node-gyp), adds a dependency for zero benefit since bun:sqlite is faster and built-in. |
| PostgreSQL / MySQL | External dependency. Massive overkill for single-replica private use with ~100 executions/week. |
| Drizzle / Kysely ORM | Unnecessary abstraction over ~5 SQL statements. Raw prepared statements are clearer and have zero overhead. |
| LevelDB / LMDB | Key-value stores lack the relational query capability needed for "cost by repo last 30 days" aggregations. |

---

### 2. Config Schema Validation: Zod v4 (already installed)

| Attribute | Value |
|-----------|-------|
| Package | `zod` |
| Installed | `^4.3.6` (already in package.json) |
| Import | `import { z } from "zod"` |

**No new dependency needed.** Zod v4 is already installed and the existing config schema in `/home/keith/src/kodiai/src/execution/config.ts` uses it extensively with `z.object()`, `.default()`, `.optional()`, `z.ZodError`, `.safeParse()`, and `.parse()`.

**Current usage in codebase:**

- `src/config.ts` -- App-level env config validation (port, secrets, bot allow list)
- `src/execution/config.ts` -- `.kodiai.yml` repo config with nested `review`, `mention`, `write` sections
- Both use `z.object({...})` with `.strict()` for unknown-key rejection

**Zod v4 migration notes (for awareness, not blocking):**

The codebase uses `.strict()` in 4 places (`src/execution/config.ts` lines 41, 44, 82, 111). In Zod v4, `.strict()` is deprecated in favor of `z.strictObject()`. However, per the Zod v4 changelog:

> "These methods are still available for backwards compatibility, and they will not be removed. They are considered legacy."

**Recommendation:** Continue using `.strict()` for now. It works. A future housekeeping PR can migrate to `z.strictObject()` if desired, but it is not blocking v0.3.

**v0.3 config schema expansion** requires only extending the existing `repoConfigSchema` with new fields. No new libraries needed. The Zod `.default()` behavior change in v4 (returns default value directly for `undefined` input) is actually the behavior the codebase already relies on, so no issues.

**Confidence: HIGH** -- Verified Zod v4.3.6 installed, `.strict()` still works, `.parse()`/`.safeParse()` API unchanged.

---

### 3. Structured Logging: Pino v10 (already installed, extend usage)

| Attribute | Value |
|-----------|-------|
| Package | `pino` |
| Installed | `^10.3.0` (already in package.json) |
| Import | `import pino from "pino"` |

**No new dependency needed.** Pino is already the project's logger. The existing `createChildLogger()` function in `src/lib/logger.ts` already supports arbitrary custom fields via `[key: string]: unknown`.

**Current logging patterns in codebase:**

The handlers already log telemetry-relevant data:

```typescript
// review.ts line 462-473
logger.info({
  prNumber: pr.number,
  conclusion: result.conclusion,
  published: result.published,
  costUsd: result.costUsd,
  numTurns: result.numTurns,
  durationMs: result.durationMs,
  sessionId: result.sessionId,
}, "Review execution completed");
```

```typescript
// mention.ts line 673-686
logger.info({
  surface: mention.surface,
  issueNumber: mention.issueNumber,
  conclusion: result.conclusion,
  published: result.published,
  writeEnabled,
  costUsd: result.costUsd,
  numTurns: result.numTurns,
  durationMs: result.durationMs,
  sessionId: result.sessionId,
}, "Mention execution completed");
```

**What changes for v0.3:**

The telemetry system should write to SQLite *in addition to* logging. Pino continues as the structured log output for stdout/operational monitoring. The SQLite database serves a different purpose: persistent queryable storage for cost tracking and reporting.

**Do NOT add pino transports or pino-roll.** The current architecture is correct: JSON to stdout, captured by the container runtime. Adding file rotation or custom transports would increase complexity for zero benefit in a single-container Azure deployment.

**Confidence: HIGH** -- Pino v10.3.0 verified installed, existing usage patterns documented from code review.

---

### 4. CLI Reporting: Bun script (no new dependencies)

| Attribute | Value |
|-----------|-------|
| Runs via | `bun run scripts/telemetry-report.ts` |
| Dependencies | `bun:sqlite` (built-in), `process.stdout` (built-in) |

**Why a Bun script, not a separate tool:**

- The report script queries the same SQLite database the server writes to.
- Bun's `bun:sqlite` provides the query layer.
- Output can be formatted as a simple text table or JSON for piping.
- No additional packages needed. `console.table()` or a manual column formatter is sufficient for operator use.

**Alternatives considered and rejected:**

| Alternative | Why Rejected |
|-------------|-------------|
| Grafana + InfluxDB | External infrastructure. Overkill for a team of ~5 operators checking costs weekly. |
| sqlite3 CLI | Available but requires manual SQL. A Bun script can provide pre-built queries (cost this month, top repos, etc.) with named commands. |
| Web dashboard route | Adds surface area to the server (auth, HTML rendering). A CLI script is simpler, safer, and sufficient for private use. |

**Confidence: HIGH** -- Standard pattern for Bun projects.

---

## What NOT to Add for v0.3

| Temptation | Why Avoid |
|------------|-----------|
| Drizzle / Kysely / Prisma ORM | The telemetry schema is ~2 tables with ~5 queries total. An ORM adds dependency weight, migration tooling complexity, and learning overhead for zero benefit at this scale. Use raw SQL with prepared statements. |
| pino-roll / pino-pretty / pino transports | Current stdout JSON logging works correctly. Container captures it. Adding transports introduces worker thread complexity and potential Bun compatibility issues. |
| OpenTelemetry / pino-opentelemetry-transport | Designed for distributed tracing across microservices. This is a single-process app. The cost/complexity ratio is terrible for the observability gain. If metrics are needed later, a `/metrics` Hono endpoint returning JSON is simpler. |
| Redis / external cache | Single replica, in-process state is fine. SQLite replaces the need for any external state store. |
| Migration tool (knex migrations, etc.) | With ~2 tables and single-user deployment, schema creation can be inline in the database initialization function. `CREATE TABLE IF NOT EXISTS` is the migration strategy. |
| `@types/better-sqlite3` | Not using better-sqlite3. `bun:sqlite` types come from `@types/bun`. |
| YAML schema validation beyond Zod | Tools like `ajv` or JSON Schema validators add a dependency when Zod already validates the parsed YAML perfectly. |
| Separate telemetry service / sidecar | Single process handles everything. A telemetry sidecar would add container orchestration complexity for a system processing <100 events/day. |

---

## Integration Points

### How SQLite Telemetry Integrates with Existing Code

The executor already returns `ExecutionResult` with `costUsd`, `numTurns`, `durationMs`, `sessionId`, and `conclusion`. Both `review.ts` and `mention.ts` handlers already log these fields. The telemetry layer should:

1. Accept the same `ExecutionResult` type plus context (owner, repo, prNumber, eventType, deliveryId)
2. Insert a row into the SQLite `executions` table
3. Be called from the same locations where the "execution completed" log lines already exist
4. Be non-blocking / fire-and-forget (wrap in try/catch, log errors, never fail the handler)

### How Config Schema Extends

The existing `repoConfigSchema` in `src/execution/config.ts` already has the exact pattern needed. v0.3 additions (new fields in `review`, `mention`, or `write` sections) follow the same `z.object().default()` nesting pattern. No structural changes to the config loading pipeline.

### How CLI Reporting Works

The report script opens the same `.sqlite` file in **read-only mode** (`new Database(path, { readonly: true })`), runs aggregation queries, and prints results. It can run while the server is writing because WAL mode allows concurrent readers.

---

## Version Compatibility Matrix (v0.3 additions)

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| `bun:sqlite` | Bun >= 1.0 | Built-in module, no version constraints beyond Bun itself |
| `bun:sqlite` WAL mode | Single-writer + multiple-readers | Server writes, CLI script reads. This is the ideal SQLite concurrency model. |
| Zod v4 `.strict()` | Zod ^4.3.6 | Deprecated but functional. Will not be removed per maintainer commitment. |
| Pino child loggers | Pino ^10.3.0 | Existing `createChildLogger()` already supports arbitrary fields. |

---

## Installation

```bash
# v0.3 requires NO new package installations.
# All needed capabilities are either already installed or built into Bun.

# Verify bun:sqlite is available (should print "ok"):
bun -e "import { Database } from 'bun:sqlite'; console.log('ok')"

# Verify current dependencies still resolve:
bun install
```

---

## Summary of Stack Decisions

| v0.3 Need | Decision | Rationale |
|-----------|----------|-----------|
| Config validation | Use existing Zod v4 | Already installed, existing patterns cover the need |
| Telemetry storage | `bun:sqlite` (built-in) | Zero dependencies, verified working, WAL mode for safe concurrent access |
| Structured logging | Use existing Pino v10 | Already installed, handlers already log the right fields |
| CLI reporting | Bun script with `bun:sqlite` | Same database, read-only mode, no new dependencies |
| Schema migrations | `CREATE TABLE IF NOT EXISTS` inline | Two tables, single deployment, no migration tool needed |

**Net new npm dependencies for v0.3: ZERO.**

This is the correct outcome for a small-scale, single-replica, private-use system. Every capability needed for enhanced config and telemetry is either already installed or built into the Bun runtime.

---

## Sources

- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) -- Full API reference, WAL mode, transactions (HIGH confidence)
- [bun:sqlite API reference](https://bun.com/reference/bun/sqlite) -- Database class, prepared statements, type mapping (HIGH confidence)
- [Bun SQLite guide (2026)](https://oneuptime.com/blog/post/2026-01-31-bun-sqlite/view) -- WAL mode setup, performance patterns (MEDIUM confidence)
- [Zod v4 migration guide](https://zod.dev/v4/changelog) -- Breaking changes, `.strict()` deprecation status, `.default()` behavior (HIGH confidence)
- [Zod v4 release notes](https://zod.dev/v4) -- New features, performance improvements (HIGH confidence)
- [Pino API documentation](https://github.com/pinojs/pino/blob/main/docs/api.md) -- Child loggers, mixin functions, custom fields (HIGH confidence)
- [Pino logger guide (SigNoz, 2026)](https://signoz.io/guides/pino-logger/) -- Structured logging patterns, telemetry integration (MEDIUM confidence)
- Local verification: `bun -e` smoke tests for `bun:sqlite` and Zod v4 (HIGH confidence)
- Codebase review: `package.json`, `src/execution/config.ts`, `src/lib/logger.ts`, `src/execution/executor.ts`, `src/handlers/review.ts`, `src/handlers/mention.ts` (HIGH confidence)

---
*Stack research for: Kodiai v0.3 Enhanced Config + Usage Telemetry*
*Researched: 2026-02-11*
