# Architecture: Enhanced Config & Telemetry Integration

**Domain:** Config validation + usage telemetry for existing GitHub App
**Researched:** 2026-02-11
**Confidence:** HIGH -- based on full codebase analysis, not speculation

## Existing Architecture (As-Is)

The system follows a pipeline pattern with clear boundaries:

```
GitHub Webhook
    |
    v
[Hono HTTP] --> [Signature Verify] --> [Dedup] --> [Event Router]
                                                        |
                                    +-------------------+-------------------+
                                    |                                       |
                              [Review Handler]                      [Mention Handler]
                                    |                                       |
                              [Job Queue]                             [Job Queue]
                           (per-installation)                      (per-installation)
                                    |                                       |
                              [Workspace Manager]                   [Workspace Manager]
                              (shallow clone)                       (shallow clone)
                                    |                                       |
                              [loadRepoConfig]                      [loadRepoConfig]
                              (.kodiai.yml)                          (.kodiai.yml)
                                    |                                       |
                              [Executor]                              [Executor]
                              (Agent SDK query())                   (Agent SDK query())
                                    |                                       |
                              [MCP Servers]                         [MCP Servers]
                              (publish to GitHub)                   (publish to GitHub)
```

### Key Observations for Integration

1. **Config is loaded twice per review job:** once in the handler (for trigger/skip checks) and once in the executor (for model/timeout). This is intentional -- handler config gates whether to proceed, executor config controls how to execute.

2. **Telemetry data already exists but is ephemeral:** The `SDKResultMessage` from Agent SDK provides `total_cost_usd`, `num_turns`, `duration_ms`, `duration_api_ms`, `usage` (tokens), and `modelUsage` (per-model breakdown). The executor extracts `costUsd`, `numTurns`, `durationMs`, `sessionId` into `ExecutionResult` -- but this data is only logged and never persisted.

3. **Structured logging is the only observability path:** All data flows through Pino JSON to stdout. There is no persistent storage layer.

4. **Single execution boundary:** Both review and mention handlers call `executor.execute()` which is the sole entry point to the Agent SDK. This is the natural telemetry injection point.

---

## Integration Architecture (To-Be)

### Principle: Modify at boundaries, add layers -- don't restructure

The existing pipeline is clean. The new features integrate by:
- **Config validation:** Enhance `loadRepoConfig()` with better error reporting, NOT by adding a new validation layer
- **Telemetry capture:** Wrap `executor.execute()` return path, NOT by instrumenting internals
- **Storage:** New standalone module that handlers call after execution, NOT embedded in the executor
- **Reporting:** Standalone CLI script that queries storage, NOT a new HTTP endpoint

### Component Map: New vs Modified

```
NEW COMPONENTS                          MODIFIED COMPONENTS
--------------                          -------------------
src/telemetry/                          src/execution/executor.ts
  store.ts        (TelemetryStore)        - Extract full SDKResultMessage fields
  types.ts        (TelemetryRecord)       - Return enriched ExecutionResult
  query.ts        (read/aggregate)
                                        src/execution/types.ts
src/telemetry/                            - Add token fields to ExecutionResult
  storage/
    sqlite.ts     (SQLite backend)      src/execution/config.ts
    types.ts      (StorageBackend)        - Better error messages (minor)

scripts/
  usage-report.ts (CLI tool)            src/handlers/review.ts
                                          - Call telemetry store after execute()

                                        src/handlers/mention.ts
                                          - Call telemetry store after execute()

                                        src/index.ts
                                          - Initialize TelemetryStore
                                          - Pass to handlers
```

---

## Integration Point 1: Config Validation

### Where Validation Happens Today

`loadRepoConfig()` in `src/execution/config.ts` handles:
1. File existence check (missing = use defaults)
2. YAML parsing (failure = throw with parse error)
3. Zod schema validation (failure = throw with field-level errors)

This already works well. The schema uses `z.object().strict()` on nested objects (write, mention) to reject unknown keys.

### What to Change

The config schema is already well-structured with Zod. "Enhanced config validation" means:

1. **Top-level `.strict()` on `repoConfigSchema`** -- currently the top-level object does NOT reject unknown keys (e.g., `foobar: true` silently passes). Adding `.strict()` catches typos.

2. **Friendlier error formatting** -- current errors are semicolon-joined strings. Format as a markdown block that could be posted as a GitHub comment if needed.

3. **Config validation result type** -- instead of throwing, return a discriminated union so callers can decide what to do with errors (log, post comment, skip job).

### Where Validation Errors Surface

```
Handler loads config
    |
    v
Config invalid?
    |
    +-- YES --> Log warning with field-level errors
    |           Skip execution (don't waste tokens on bad config)
    |           Optionally post error comment to PR/issue
    |
    +-- NO --> Continue to executor
```

The handler is the right place to surface config errors because:
- The handler has the GitHub context (owner/repo/PR) to post error comments
- The executor should receive validated config, not raw YAML
- The handler already loads config for trigger checks -- adding validation here is natural

### Architectural Decision

**Do NOT add a separate "config validator" module.** The existing `loadRepoConfig()` already validates via Zod. Enhance it in-place:
- Make the top-level schema `.strict()`
- Return a result type instead of throwing (or keep throwing with better error objects)
- Let handlers catch and surface errors

---

## Integration Point 2: Telemetry Capture

### Data Available from Agent SDK

The `SDKResultMessage` (both success and error subtypes) provides:

| Field | Type | Description |
|-------|------|-------------|
| `total_cost_usd` | `number` | Total API cost |
| `num_turns` | `number` | Conversation turns |
| `duration_ms` | `number` | Wall-clock duration |
| `duration_api_ms` | `number` | Time spent in API calls |
| `session_id` | `string` | Agent session identifier |
| `usage` | `NonNullableUsage` | Aggregate token counts (from Anthropic SDK `BetaUsage`) |
| `modelUsage` | `Record<string, ModelUsage>` | Per-model breakdown with `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD` |
| `subtype` | `string` | `"success"` or error reason (`"error_during_execution"`, `"error_max_turns"`, etc.) |
| `stop_reason` | `string \| null` | Why the model stopped |

**Currently captured in `ExecutionResult`:** `costUsd`, `numTurns`, `durationMs`, `sessionId`, `conclusion`, `published`

**Currently LOST (not captured):** `duration_api_ms`, `usage` (all token counts), `modelUsage` (per-model breakdown), `stop_reason`, detailed error subtype

### Where to Capture

The executor's `for await` loop already extracts `resultMessage`. The injection is a one-line change to capture the full message:

```
executor.execute(context)
    |
    [existing] Stream messages, extract resultMessage
    |
    [CHANGE] Build enriched ExecutionResult with all SDK fields
    |
    return ExecutionResult
```

The enriched `ExecutionResult` adds:

```typescript
// Added to ExecutionResult
inputTokens: number | undefined;
outputTokens: number | undefined;
cacheReadInputTokens: number | undefined;
cacheCreationInputTokens: number | undefined;
durationApiMs: number | undefined;
model: string | undefined;           // from config, for correlation
stopReason: string | null | undefined;
```

### Where to Persist

Persistence happens in the HANDLER, not the executor. The handler already has the full context (owner, repo, PR, event type, delivery ID) and the execution result. After `executor.execute()` returns:

```
handler calls executor.execute()
    |
    v
result = ExecutionResult (enriched)
    |
    v
[existing] Log result fields
    |
    v
[NEW] telemetryStore.record({
    deliveryId,
    installationId,
    owner,
    repo,
    prNumber,
    eventType,
    jobType: "review" | "mention",
    ...result telemetry fields,
    timestamp: Date.now(),
})
    |
    v
[existing] Post-execution logic (auto-approve, error comment, etc.)
```

### Architectural Decision

**Telemetry recording is fire-and-forget.** If the store write fails, log the error and continue. Telemetry must NEVER block or fail the webhook processing pipeline. The store.record() call should be wrapped in a try/catch with a warning log.

---

## Integration Point 3: Storage Layer

### Requirements

- Append-only writes (one record per execution)
- Read patterns: filter by date range, repo, event type; aggregate cost/tokens
- Single replica (no concurrent write contention)
- Survives process restart (not in-memory)
- No external dependencies

### Recommended: Bun's Built-in SQLite (`bun:sqlite`)

Bun ships with a native, high-performance SQLite driver (`bun:sqlite`). Zero npm dependencies. Synchronous API that is 3-6x faster than `better-sqlite3`.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,              -- ISO 8601
    delivery_id TEXT NOT NULL,
    installation_id INTEGER NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    pr_number INTEGER,                    -- NULL for issue-only mentions
    event_type TEXT NOT NULL,             -- e.g., "pull_request.opened"
    job_type TEXT NOT NULL,               -- "review" | "mention"
    conclusion TEXT NOT NULL,             -- "success" | "failure" | "error"
    cost_usd REAL,
    num_turns INTEGER,
    duration_ms INTEGER,
    duration_api_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    model TEXT,
    session_id TEXT,
    stop_reason TEXT,
    published INTEGER,                    -- 0 | 1
    is_timeout INTEGER,                   -- 0 | 1
    error_message TEXT
);

-- Query indexes (create only what's needed for reporting)
CREATE INDEX IF NOT EXISTS idx_executions_timestamp ON executions(timestamp);
CREATE INDEX IF NOT EXISTS idx_executions_repo ON executions(owner, repo);
CREATE INDEX IF NOT EXISTS idx_executions_installation ON executions(installation_id);
```

### Storage Architecture

```
src/telemetry/
    types.ts          -- TelemetryRecord type definition
    store.ts          -- TelemetryStore interface + factory
    storage/
        sqlite.ts     -- SQLite backend implementation
        types.ts      -- StorageBackend interface
```

**Interface pattern:**

```typescript
interface TelemetryStore {
    record(entry: TelemetryRecord): void;     // sync, fire-and-forget
    query(filter: QueryFilter): TelemetryRecord[];
    aggregate(filter: QueryFilter): AggregateResult;
    close(): void;
}
```

The `record()` method is synchronous because `bun:sqlite` is synchronous. This is an advantage -- no async complexity, no promise chains for a simple INSERT.

### File Location

SQLite database file: `data/telemetry.db` (relative to project root, gitignored).

In production (Azure Container Apps), this lives on the container's ephemeral filesystem. For durable storage:
- Option A: Mount an Azure Files share to `/app/data/` (simple, recommended)
- Option B: Periodic backup of the `.db` file to blob storage (more complex)
- Option C: Accept ephemeral storage -- data survives restarts (container reuse) but not redeployments. Acceptable for private/low-volume use.

**Recommendation:** Start with Option C (ephemeral) because the volume is low and the data is nice-to-have, not critical. Add durable storage later if needed.

### Initialization

```
src/index.ts (startup)
    |
    v
const telemetryStore = createTelemetryStore({
    dbPath: process.env.TELEMETRY_DB_PATH ?? "data/telemetry.db",
    logger,
});
    |
    v
Pass telemetryStore to createReviewHandler() and createMentionHandler()
```

The store creates the database and tables on first use (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## Integration Point 4: Reporting CLI

### Architecture

A standalone script (`scripts/usage-report.ts`) that:
1. Opens the same SQLite database
2. Runs aggregate queries
3. Prints formatted output to stdout

```
$ bun run scripts/usage-report.ts --range 7d
$ bun run scripts/usage-report.ts --range 2026-02-01..2026-02-11
$ bun run scripts/usage-report.ts --repo kodiai/xbmc --range 30d
```

### Why a Script, Not an HTTP Endpoint

- No authentication needed (already on the server)
- No CORS, no API versioning, no attack surface
- Can pipe to `jq`, `grep`, other tools
- Trivially testable
- Matches the operational model (SSH to server, run commands)

### Query Patterns

| Report | SQL Pattern |
|--------|-------------|
| Total cost in range | `SUM(cost_usd) WHERE timestamp BETWEEN ? AND ?` |
| Cost by repo | `GROUP BY owner, repo` |
| Cost by job type | `GROUP BY job_type` |
| Average duration | `AVG(duration_ms)` |
| Token breakdown | `SUM(input_tokens), SUM(output_tokens)` |
| Error rate | `COUNT(*) WHERE conclusion = 'error' / COUNT(*)` |
| Top repos by cost | `ORDER BY SUM(cost_usd) DESC LIMIT 10` |

### Output Format

Default: human-readable table. With `--json` flag: JSON for programmatic consumption.

---

## Data Flow: End-to-End

```
GitHub Webhook
    |
    v
[Hono HTTP] --> [Verify] --> [Dedup] --> [Router]
                                              |
                                        [Handler]
                                              |
                                        [loadRepoConfig]  <-- ENHANCED: .strict(), better errors
                                              |
                                        Config invalid? --> Log + skip + optional error comment
                                              |
                                        [Job Queue]
                                              |
                                        [Workspace Manager]
                                              |
                                        [Executor]
                                              |
                                        SDKResultMessage (full fields)
                                              |
                                        ExecutionResult (enriched)
                                              |
                                   +----------+----------+
                                   |                     |
                              [Log result]         [telemetryStore.record()]
                                   |                     |
                              [Post-exec logic]    [SQLite INSERT]
                                   |                     |
                              [GitHub API calls]   (fire-and-forget)
```

---

## Build Order and Dependencies

### Phase 1: Config Enhancement

**Depends on:** Nothing new
**Modifies:** `src/execution/config.ts`, tests
**Rationale:** Config changes are self-contained. Adding `.strict()` to the top-level schema and improving error messages requires no new modules. This is the smallest, safest change.

### Phase 2: Telemetry Types + Enriched ExecutionResult

**Depends on:** Nothing (parallel with Phase 1 if desired)
**Modifies:** `src/execution/types.ts`, `src/execution/executor.ts`
**New:** `src/telemetry/types.ts`
**Rationale:** Define the data shape before building storage. Enriching ExecutionResult is a pure data extraction change -- the executor already has access to `resultMessage`, it just discards fields.

### Phase 3: Storage Layer

**Depends on:** Phase 2 (needs TelemetryRecord type)
**New:** `src/telemetry/store.ts`, `src/telemetry/storage/sqlite.ts`, `src/telemetry/storage/types.ts`
**Rationale:** Storage is a new module with no dependencies on existing code beyond the type definitions.

### Phase 4: Handler Integration

**Depends on:** Phase 2 + Phase 3
**Modifies:** `src/index.ts`, `src/handlers/review.ts`, `src/handlers/mention.ts`
**Rationale:** Wiring the store into handlers requires the store to exist and the enriched result to be available.

### Phase 5: Reporting CLI

**Depends on:** Phase 3 (needs storage layer)
**New:** `scripts/usage-report.ts`
**Rationale:** The CLI reads from the same SQLite database the store writes to. Can be built as soon as storage exists (even before handler integration, using manual test data).

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Middleware-Based Telemetry
**What:** Adding Hono middleware that wraps every request with timing/metrics.
**Why bad:** The webhook endpoint returns 200 immediately (fire-and-fork). Request-level middleware captures nothing useful about execution duration or cost. The actual work happens asynchronously in the job queue.
**Instead:** Capture telemetry at the executor result boundary, inside the async job.

### Anti-Pattern 2: Separate Config Validation Pass
**What:** Creating a `validateConfig()` function called before `loadRepoConfig()`.
**Why bad:** `loadRepoConfig()` already validates via Zod. A separate pass duplicates logic and creates a maintenance burden where the two can drift out of sync.
**Instead:** Enhance `loadRepoConfig()` in-place with better error objects and `.strict()`.

### Anti-Pattern 3: Telemetry in the Executor
**What:** Having `executor.execute()` directly call `telemetryStore.record()`.
**Why bad:** The executor does not have handler-level context (owner, repo, PR number, event type, job type). Pushing context down into the executor bloats its interface. The executor's job is to run the Agent SDK, not to persist metrics.
**Instead:** Return enriched data from executor; let the handler (which has full context) write to the store.

### Anti-Pattern 4: Async Storage Writes
**What:** Making `telemetryStore.record()` async and awaiting it.
**Why bad:** Adds unnecessary complexity. `bun:sqlite` is synchronous. The INSERT is sub-millisecond. Making it async adds error handling, promise chains, and potential for unhandled rejections -- all for zero benefit.
**Instead:** Keep `record()` synchronous. Wrap the call in try/catch at the handler level.

### Anti-Pattern 5: Building a Dashboard
**What:** Adding an HTTP endpoint that serves usage reports.
**Why bad:** Requires authentication (the server is publicly accessible via webhooks). Adds attack surface. The audience is 1-2 operators who have SSH access.
**Instead:** CLI script run on the server. Output to stdout. Pipe to `jq` for JSON processing.

---

## Patterns to Follow

### Pattern 1: Fire-and-Forget Telemetry
**What:** Telemetry writes never block or fail the main pipeline.
**When:** Always.
```typescript
// In handler, after executor.execute()
try {
    telemetryStore.record(buildTelemetryRecord(context, result));
} catch (err) {
    logger.warn({ err }, "Failed to record telemetry");
}
// Continue with post-execution logic regardless
```

### Pattern 2: Factory + Interface for Storage
**What:** Define a `StorageBackend` interface so the storage implementation can be swapped.
**When:** Building the storage layer.
```typescript
interface StorageBackend {
    insert(record: TelemetryRecord): void;
    query(filter: QueryFilter): TelemetryRecord[];
    aggregate(filter: QueryFilter): AggregateResult;
    close(): void;
}
```
This makes testing easy (inject a mock/in-memory backend) and leaves the door open for future backends (JSON file, remote DB) without changing the store interface.

### Pattern 3: Dependency Injection via Constructor
**What:** Pass `telemetryStore` to handlers the same way `logger`, `executor`, `githubApp` are passed today.
**When:** Wiring up handler integration.
```typescript
createReviewHandler({
    eventRouter,
    jobQueue,
    workspaceManager,
    githubApp,
    executor,
    logger,
    telemetryStore,  // NEW
});
```
Follows the existing codebase pattern exactly. No globals, no singletons.

### Pattern 4: Schema Migration via Version Check
**What:** Store a schema version in SQLite and run migrations on startup.
**When:** Building the storage layer.
```typescript
// On init:
// 1. CREATE TABLE IF NOT EXISTS schema_version (version INTEGER)
// 2. Check current version
// 3. Run any pending migrations
// 4. Update version
```
This is overkill for v0.3 but trivial to add and prevents future headaches when the schema evolves.

---

## Scalability Considerations

| Concern | At current scale (1-5 repos) | At 50 repos | At 500+ repos |
|---------|------------------------------|-------------|---------------|
| SQLite write throughput | Trivial (~1 INSERT/min) | Still trivial (~10/min) | Consider WAL mode, may need external DB |
| Database file size | KB/month | Low MB/month | Consider retention policy / VACUUM |
| CLI query speed | Instant | Instant | Add date-range indexes (already in schema) |
| Config load time | Trivial (one YAML parse) | Same | Same (per-repo, per-job) |

For the foreseeable future (private use, known repos), SQLite is more than adequate. The bottleneck is Agent SDK execution time (minutes per job), not storage I/O.

---

## Sources

- Codebase analysis: `src/execution/executor.ts`, `src/execution/config.ts`, `src/execution/types.ts`, `src/handlers/review.ts`, `src/handlers/mention.ts`, `src/index.ts`, `src/jobs/queue.ts`
- Agent SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (SDKResultMessage, ModelUsage, NonNullableUsage)
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) -- built-in, zero-dependency, synchronous API
- [Bun SQLite API reference](https://bun.com/reference/bun/sqlite/Database) -- Database class, prepared statements
