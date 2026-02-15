# Phase 23: Telemetry Foundation - Research

**Researched:** 2026-02-11
**Domain:** SQLite telemetry storage with bun:sqlite, fire-and-forget capture pipeline
**Confidence:** HIGH

## Summary

Phase 23 requires building a persistent telemetry storage layer using SQLite (via Bun's built-in `bun:sqlite` module), capturing execution metadata from the Claude Agent SDK after every review/mention/write execution, and ensuring writes never block the critical job path.

The core technical challenge is straightforward: `bun:sqlite` provides a synchronous, high-performance SQLite driver built directly into Bun (no npm dependencies needed). Since the API is synchronous and local disk I/O is sub-millisecond for single-row inserts, "fire-and-forget" simply means wrapping the synchronous insert in a try-catch so failures are logged but never thrown to the caller. WAL mode enables concurrent reads from external tools (Phase 25's CLI reporter) while the server is writing.

The `ExecutionResult` type already captures `costUsd` and `durationMs`, but TELEM-01 requires enriching it with per-model token counts (`inputTokens`, `outputTokens`) and `stopReason` from the SDK's `SDKResultMessage`. The SDK's `modelUsage: Record<string, ModelUsage>` field provides per-model breakdowns with `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, and `costUSD`. The `usage: NonNullableUsage` field provides aggregate Anthropic API usage. The `stop_reason` field is directly available on the result message.

**Primary recommendation:** Use `bun:sqlite` (zero dependencies, 3-6x faster than better-sqlite3) with WAL mode, store the database at a configurable path (defaulting to `./data/kodiai-telemetry.db`), and capture telemetry via a simple `recordExecution()` function called from handlers after `executor.execute()` returns.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` | Built-in (Bun 1.3.8) | SQLite database driver | Zero dependencies, 3-6x faster than better-sqlite3, synchronous API ideal for simple inserts, ships with Bun |
| `bun:test` | Built-in (Bun 1.3.8) | Test framework | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | ^10.3.0 | Logging | Already in project; log telemetry errors without throwing |
| `zod` | ^4.3.6 | Schema validation | Already in project; validate config for telemetry DB path |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bun:sqlite` | `better-sqlite3` | External dependency, slower; only needed if Bun's SQLite has bugs |
| `bun:sqlite` | `drizzle-orm` + `bun:sqlite` | ORM overhead not justified for a single table with simple queries |
| SQLite | PostgreSQL/Redis | Massively over-engineered for single-replica telemetry; adds infra complexity |

**Installation:**
```bash
# No installation needed -- bun:sqlite is built into Bun
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  telemetry/
    store.ts           # TelemetryStore class: open DB, insert, purge, checkpoint, close
    store.test.ts      # Tests using in-memory SQLite (:memory:)
    types.ts           # TelemetryRecord type, TelemetryStore interface
  execution/
    types.ts           # Updated ExecutionResult with token fields (TELEM-01)
    executor.ts        # Updated to capture SDK token data into ExecutionResult
  handlers/
    review.ts          # Add telemetry capture after executor.execute()
    mention.ts         # Add telemetry capture after executor.execute()
  index.ts             # Initialize TelemetryStore, pass to handlers, run startup purge + checkpoint
```

### Pattern 1: Singleton Store with Dependency Injection
**What:** Create a single `TelemetryStore` instance at startup and pass it to handlers via dependency injection (same pattern as `logger`, `jobQueue`, `executor`).
**When to use:** Always -- this matches the existing codebase architecture.
**Example:**
```typescript
// src/telemetry/store.ts
import { Database } from "bun:sqlite";
import type { Logger } from "pino";

export interface TelemetryStore {
  record(entry: TelemetryRecord): void;
  purgeOlderThan(days: number): number;
  checkpoint(): void;
  close(): void;
}

export function createTelemetryStore(opts: {
  dbPath: string;
  logger: Logger;
}): TelemetryStore {
  const db = new Database(opts.dbPath, { create: true });

  // WAL mode for concurrent read/write (TELEM-06)
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");

  // Create table if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivery_id TEXT,
      repo TEXT NOT NULL,
      pr_number INTEGER,
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

  // Index for retention purge and reporting queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_executions_created_at
    ON executions(created_at)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_executions_repo
    ON executions(repo)
  `);

  // Prepared statements (cached)
  const insertStmt = db.query(`
    INSERT INTO executions (
      delivery_id, repo, pr_number, event_type, provider, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      duration_ms, cost_usd, conclusion, session_id, num_turns, stop_reason
    ) VALUES (
      $deliveryId, $repo, $prNumber, $eventType, $provider, $model,
      $inputTokens, $outputTokens, $cacheReadTokens, $cacheCreationTokens,
      $durationMs, $costUsd, $conclusion, $sessionId, $numTurns, $stopReason
    )
  `);

  let writeCount = 0;

  return {
    record(entry: TelemetryRecord): void {
      insertStmt.run({
        $deliveryId: entry.deliveryId ?? null,
        $repo: entry.repo,
        $prNumber: entry.prNumber ?? null,
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

      writeCount++;
      if (writeCount >= 1000) {
        this.checkpoint();
        writeCount = 0;
      }
    },

    purgeOlderThan(days: number): number {
      const result = db.run(
        `DELETE FROM executions WHERE created_at < datetime('now', $modifier)`,
        { $modifier: `-${days} days` },
      );
      return result.changes;
    },

    checkpoint(): void {
      db.run("PRAGMA wal_checkpoint(PASSIVE)");
    },

    close(): void {
      db.close(false);
    },
  };
}
```

### Pattern 2: Fire-and-Forget Telemetry Capture
**What:** After `executor.execute()` returns, call `telemetryStore.record()` inside a try-catch. Since `bun:sqlite` is synchronous and local-disk inserts take <1ms, no async wrapping is needed. The try-catch ensures a failed write never propagates.
**When to use:** In every handler after execution completes (TELEM-03, TELEM-05).
**Example:**
```typescript
// In review.ts handler, after executor.execute() returns:
const result = await executor.execute(context);

// Fire-and-forget telemetry (TELEM-03, TELEM-05)
try {
  telemetryStore.record({
    deliveryId: event.id,
    repo: `${apiOwner}/${apiRepo}`,
    prNumber: pr.number,
    eventType: `pull_request.${payload.action}`,
    model: result.model ?? "unknown",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheCreationTokens: result.cacheCreationTokens,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    conclusion: result.conclusion,
    sessionId: result.sessionId,
    numTurns: result.numTurns,
    stopReason: result.stopReason,
  });
} catch (err) {
  logger.warn({ err }, "Telemetry write failed (non-blocking)");
}
```

### Pattern 3: Enriched ExecutionResult from SDK
**What:** Expand `ExecutionResult` to include token-level data extracted from `SDKResultMessage`.
**When to use:** TELEM-01 requires this.
**Example:**
```typescript
// Updated ExecutionResult type
export type ExecutionResult = {
  conclusion: "success" | "failure" | "error";
  costUsd: number | undefined;
  numTurns: number | undefined;
  durationMs: number | undefined;
  sessionId: string | undefined;
  published?: boolean;
  errorMessage: string | undefined;
  isTimeout?: boolean;
  // New fields for TELEM-01:
  model: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cacheReadTokens: number | undefined;
  cacheCreationTokens: number | undefined;
  stopReason: string | undefined;
};

// In executor.ts, extract from SDKResultMessage:
// resultMessage.modelUsage is Record<string, ModelUsage>
// Sum across all models (usually just one)
const modelEntries = Object.entries(resultMessage.modelUsage ?? {});
const primaryModel = modelEntries[0]?.[0] ?? config.model;
const totalInput = modelEntries.reduce((sum, [, u]) => sum + u.inputTokens, 0);
const totalOutput = modelEntries.reduce((sum, [, u]) => sum + u.outputTokens, 0);
const totalCacheRead = modelEntries.reduce((sum, [, u]) => sum + u.cacheReadInputTokens, 0);
const totalCacheCreation = modelEntries.reduce((sum, [, u]) => sum + u.cacheCreationInputTokens, 0);

return {
  conclusion: resultMessage.subtype === "success" ? "success" : "failure",
  costUsd: resultMessage.total_cost_usd,
  numTurns: resultMessage.num_turns,
  durationMs: resultMessage.duration_ms ?? durationMs,
  sessionId: resultMessage.session_id,
  published,
  errorMessage: undefined,
  model: primaryModel,
  inputTokens: totalInput,
  outputTokens: totalOutput,
  cacheReadTokens: totalCacheRead,
  cacheCreationTokens: totalCacheCreation,
  stopReason: resultMessage.stop_reason ?? undefined,
};
```

### Anti-Patterns to Avoid
- **Async wrapping of bun:sqlite:** The API is intentionally synchronous. Wrapping in `Promise.resolve()` or `setTimeout()` adds complexity with no benefit for local disk writes.
- **Global singleton without DI:** Do NOT use a module-level `let db = ...` pattern. Pass the store instance through the existing dependency injection tree (like `logger`, `jobQueue`).
- **Storing the DB in Azure Files:** SQLite WAL mode does NOT work on network filesystems (Azure Files/SMB). Store on local container filesystem or ephemeral volume only. See "Common Pitfalls" below.
- **Using an ORM for a single table:** Drizzle or TypeORM adds layers of abstraction for no gain here.
- **VACUUM after every purge:** VACUUM rebuilds the entire database and locks it. Use `auto_vacuum = INCREMENTAL` or skip VACUUM entirely for an append-mostly workload.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite database driver | Custom FFI bindings | `bun:sqlite` (built-in) | Battle-tested, maintained by Bun team, synchronous API |
| WAL mode management | Custom file-level locking | `PRAGMA journal_mode = WAL` + `PRAGMA wal_checkpoint(PASSIVE)` | SQLite handles all concurrency internally |
| Retention cleanup scheduling | `setInterval` with manual timer management | Simple counter-based or startup-based approach | Process only needs to purge on startup and periodically; no cron needed |
| Schema migrations | Custom migration system | Inline `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` | Single table, no complex migrations needed for v0.3 |
| Parameterized queries | String interpolation | Prepared statements with `$param` bindings | SQL injection prevention, better performance from statement caching |

**Key insight:** `bun:sqlite` handles all the hard parts (WAL, prepared statements, transactions). The application code is just schema definition, a single INSERT statement, a single DELETE statement, and a PRAGMA call.

## Common Pitfalls

### Pitfall 1: SQLite on Network Filesystems (Azure Files)
**What goes wrong:** SQLite requires POSIX file-locking semantics. Azure Files (SMB/CIFS) does not support the locking mechanisms SQLite needs. WAL mode fails with `SQLITE_BUSY` errors, and data corruption is possible.
**Why it happens:** Azure Container Apps' only *permanent* storage option is Azure Files. Container-scoped and replica-scoped storage are ephemeral.
**How to avoid:** Store the SQLite database on local container filesystem (e.g., `/app/data/`). Accept that data is ephemeral and lost on container restart/redeploy. For this use case (90-day telemetry, single replica, min/max replicas = 1), losing historical telemetry on redeploy is acceptable because: (a) telemetry is operational convenience, not critical data, (b) the container rarely restarts (Azure Container Apps keeps the same replica alive), (c) future enhancement could add periodic SQLite backup to Azure Blob Storage if needed.
**Warning signs:** `SQLITE_BUSY: database is locked` errors at startup or during writes.

### Pitfall 2: Forgetting to Set busy_timeout
**What goes wrong:** Default `busy_timeout` is 0, meaning any lock contention causes immediate failure. The CLI reporter (Phase 25) reading the database while the server is writing can trigger this.
**Why it happens:** Many tutorials omit this critical PRAGMA.
**How to avoid:** Always set `PRAGMA busy_timeout = 5000` immediately after opening the database. This tells SQLite to retry for up to 5 seconds before returning SQLITE_BUSY.
**Warning signs:** Intermittent `SQLITE_BUSY` errors in logs.

### Pitfall 3: WAL File Growing Unbounded
**What goes wrong:** The WAL file grows continuously if checkpointing never completes or is disabled.
**Why it happens:** Automatic checkpointing triggers at 1000 pages by default, but if a long-running reader holds a snapshot, the checkpoint can't reclaim pages (checkpoint starvation).
**How to avoid:** Run `PRAGMA wal_checkpoint(PASSIVE)` explicitly on startup and every ~1000 writes (TELEM-08). PASSIVE mode never blocks other connections. The CLI reporter should use short-lived connections (open, query, close) to avoid holding WAL snapshots.
**Warning signs:** WAL file (`*-wal`) grows larger than the main database file.

### Pitfall 4: Blocking the Job Queue with Telemetry Errors
**What goes wrong:** A telemetry write failure throws an exception that propagates up through the handler, causing the job to fail when it should have succeeded.
**Why it happens:** The telemetry `record()` call is inside the handler's try block without its own error boundary.
**How to avoid:** Always wrap `telemetryStore.record()` in its own try-catch. Log the error but never rethrow. The handler's success/failure should depend only on the executor result and GitHub API calls.
**Warning signs:** Jobs failing with SQLite errors in the stack trace.

### Pitfall 5: Not Creating the Data Directory
**What goes wrong:** `new Database("./data/kodiai-telemetry.db")` fails if `./data/` directory doesn't exist.
**Why it happens:** SQLite's `create: true` creates the file, not the directory.
**How to avoid:** Use `mkdirSync` (or `Bun.write` with a mkdir) before opening the database. Or use `fs.mkdirSync(dir, { recursive: true })`.
**Warning signs:** `SQLITE_CANTOPEN` error at startup.

### Pitfall 6: Incorrect DateTime Handling for Retention
**What goes wrong:** Rows never get purged because the `created_at` format doesn't match the DELETE condition.
**Why it happens:** SQLite has no native datetime type. If `created_at` is stored as a Unix timestamp but compared with `datetime('now')`, the comparison is string-based and always wrong.
**How to avoid:** Use ISO-8601 format consistently: `DEFAULT (datetime('now'))` stores as `YYYY-MM-DD HH:MM:SS`. The purge query uses `datetime('now', '-90 days')` which matches.
**Warning signs:** Row count grows indefinitely despite purge running.

### Pitfall 7: Testing with File-Based Databases Leaving Artifacts
**What goes wrong:** Tests create SQLite files on disk that are never cleaned up, causing test pollution.
**Why it happens:** Using file paths instead of `:memory:` in tests.
**How to avoid:** Always use `:memory:` for unit tests. The `createTelemetryStore` function should accept a path parameter, making it easy to pass `:memory:` in tests.
**Warning signs:** Stale `.db`, `.db-wal`, `.db-shm` files appearing in the project.

## Code Examples

Verified patterns from official sources:

### Database Initialization with Recommended PRAGMAs
```typescript
// Source: https://bun.com/docs/runtime/sqlite + https://sqlite.org/wal.html
import { Database } from "bun:sqlite";

const db = new Database(dbPath, { create: true });

// Must be set per-connection, not persistent across reopens
db.run("PRAGMA journal_mode = WAL");       // Enable WAL mode
db.run("PRAGMA synchronous = NORMAL");     // Safe with WAL, better perf than FULL
db.run("PRAGMA busy_timeout = 5000");      // Wait 5s before SQLITE_BUSY
db.run("PRAGMA cache_size = -2000");       // 2MB cache (negative = KiB)
db.run("PRAGMA foreign_keys = ON");        // Enforce FK constraints (if used)
```

### Prepared Statement with Named Parameters
```typescript
// Source: https://bun.com/docs/runtime/sqlite
const stmt = db.query(`
  INSERT INTO executions (delivery_id, repo, cost_usd)
  VALUES ($deliveryId, $repo, $costUsd)
`);

stmt.run({
  $deliveryId: "abc-123",
  $repo: "owner/repo",
  $costUsd: 0.42,
});
```

### Transaction for Batch Operations
```typescript
// Source: https://bun.com/docs/runtime/sqlite
const insertMany = db.transaction((records: TelemetryRecord[]) => {
  for (const r of records) {
    insertStmt.run(r);
  }
  return records.length;
});

// Atomic: all succeed or all rollback
insertMany(records);
```

### Retention Purge
```typescript
// Application-level pattern for TELEM-07
const purgeResult = db.run(
  "DELETE FROM executions WHERE created_at < datetime('now', '-90 days')"
);
logger.info({ purged: purgeResult.changes }, "Telemetry retention purge complete");
```

### WAL Checkpoint
```typescript
// Source: https://sqlite.org/wal.html
// PASSIVE: never blocks, best for periodic maintenance
db.run("PRAGMA wal_checkpoint(PASSIVE)");

// TRUNCATE: more aggressive, truncates WAL file (use sparingly)
db.run("PRAGMA wal_checkpoint(TRUNCATE)");
```

### Testing with In-Memory Database
```typescript
// Pattern used throughout kodiai codebase
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("TelemetryStore", () => {
  let store: TelemetryStore;

  beforeEach(() => {
    store = createTelemetryStore({
      dbPath: ":memory:",
      logger: mockLogger,
    });
  });

  afterEach(() => {
    store.close();
  });

  test("records execution telemetry", () => {
    store.record({ /* ... */ });
    // Query directly from the underlying DB to verify
  });
});
```

### SDK Result Message Data Extraction
```typescript
// Source: @anthropic-ai/claude-agent-sdk sdk.d.ts
// SDKResultSuccess has these fields:
//   total_cost_usd: number
//   num_turns: number
//   duration_ms: number
//   stop_reason: string | null
//   usage: NonNullableUsage (aggregate Anthropic API usage)
//   modelUsage: Record<string, ModelUsage>
//
// ModelUsage = {
//   inputTokens: number;
//   outputTokens: number;
//   cacheReadInputTokens: number;
//   cacheCreationInputTokens: number;
//   webSearchRequests: number;
//   costUSD: number;
//   contextWindow: number;
//   maxOutputTokens: number;
// }

// Extract from result:
const modelEntries = Object.entries(resultMessage.modelUsage ?? {});
const primaryModel = modelEntries[0]?.[0] ?? config.model;
const totalInput = modelEntries.reduce(
  (sum, [, u]) => sum + u.inputTokens, 0
);
const totalOutput = modelEntries.reduce(
  (sum, [, u]) => sum + u.outputTokens, 0
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `better-sqlite3` npm package | `bun:sqlite` built-in | Bun 1.0 (Sept 2023) | Zero dependencies, 3-6x faster |
| Async SQLite wrappers (node-sqlite3) | Synchronous API (bun:sqlite) | Bun 1.0 | Simpler code, no callback hell for local disk |
| Journal mode DELETE (default) | WAL mode for server apps | Long-standing SQLite best practice | Concurrent readers, better write throughput |
| Custom retry logic for SQLITE_BUSY | `PRAGMA busy_timeout` | Always available in SQLite | Built-in retry with backoff |

**Deprecated/outdated:**
- `better-sqlite3`: Still works but unnecessary in Bun projects -- `bun:sqlite` is faster and built-in
- `sql.js` (WASM SQLite): Not needed in Bun, which has native SQLite bindings
- `PRAGMA journal_mode = DELETE`: Should not be used for server applications; WAL is strictly better for this use case

## Open Questions

1. **Data persistence across container restarts**
   - What we know: Azure Container Apps ephemeral storage (container-scoped) is lost on restart. Azure Files does not support SQLite WAL mode. The app runs with `--min-replicas 1 --max-replicas 1`.
   - What's unclear: How frequently does Azure Container Apps restart/replace containers? (Typically: only on deploy, crash, or scale-to-zero events.)
   - Recommendation: Accept ephemeral storage for v0.3. Telemetry is operational convenience, not critical data. Document the limitation. Future enhancement: periodic backup to Azure Blob Storage, or switch to a managed database if multi-replica scaling is needed. The Dockerfile may need a `RUN mkdir -p /app/data` to ensure the directory exists, and the data path should be configurable via environment variable (e.g., `TELEMETRY_DB_PATH`).

2. **Config model name availability in error/timeout paths**
   - What we know: When execution times out or errors before the SDK returns a result, `resultMessage` is undefined. The `config.model` value is available inside the executor but not currently passed back in `ExecutionResult`.
   - What's unclear: Whether the model name matters for error rows in telemetry.
   - Recommendation: Pass `config.model` through the executor's error path so telemetry rows always have a model name. Alternatively, set model to "unknown" for error cases. The former is cleaner.

3. **Exact DB path for deployment**
   - What we know: The Dockerfile runs as user `bun` in `/app`. The `bun` user needs write access.
   - What's unclear: Whether `/app/data/` is writable by the `bun` user.
   - Recommendation: Add `RUN mkdir -p /app/data && chown bun:bun /app/data` to Dockerfile before the `USER bun` directive. Make the path configurable via `TELEMETRY_DB_PATH` env var with default `./data/kodiai-telemetry.db`.

## Sources

### Primary (HIGH confidence)
- `bun:sqlite` official docs (https://bun.com/docs/runtime/sqlite) - Database constructor, WAL mode, prepared statements, transaction API
- `@anthropic-ai/claude-agent-sdk` type definitions (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) - SDKResultMessage, SDKResultSuccess, ModelUsage types
- SQLite WAL documentation (https://sqlite.org/wal.html) - Checkpoint modes, concurrent access, WAL file management
- Azure Container Apps storage documentation (https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts) - Storage types, Azure Files limitations

### Secondary (MEDIUM confidence)
- Bun SQLite API reference (https://bun.com/reference/bun/sqlite) - Constructor options, method signatures
- SQLite PRAGMA reference (https://www.sqlite.org/pragma.html) - busy_timeout, synchronous, cache_size, wal_checkpoint
- PocketBase Azure Container Apps discussion (https://github.com/pocketbase/pocketbase/discussions/2745) - SQLite + Azure Files SQLITE_BUSY issues confirmed

### Tertiary (LOW confidence)
- None -- all findings verified through official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `bun:sqlite` is built into Bun, well-documented, already verified against official docs
- Architecture: HIGH - Follows existing codebase patterns (DI, factory functions), SDK types verified from type definitions
- Pitfalls: HIGH - SQLite WAL behavior verified from sqlite.org; Azure Files limitation confirmed by multiple sources
- SDK data extraction: HIGH - Types verified directly from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`

**Codebase integration points verified:**
- `ExecutionResult` in `src/execution/types.ts` - needs new fields
- `executor.ts` - needs to extract `modelUsage`, `stop_reason` from `SDKResultMessage`
- `review.ts` handler at line ~466 - telemetry capture point after `executor.execute()`
- `mention.ts` handler at line ~678 - telemetry capture point after `executor.execute()`
- `index.ts` - initialization point for `TelemetryStore`, passes to handlers

**Research date:** 2026-02-11
**Valid until:** 2026-03-13 (30 days -- bun:sqlite is stable, SQLite is mature)
