# Domain Pitfalls: Enhanced Config + Telemetry

**Domain:** Adding config schema evolution and usage telemetry to an existing GitHub App (Kodiai)
**Researched:** 2026-02-11
**Confidence:** HIGH (verified against codebase inspection, official Anthropic docs, SQLite docs, Zod docs)

## Critical Pitfalls

Mistakes that cause broken deployments, data loss, or require significant rework.

### Pitfall 1: Strict Zod Sub-Schemas Reject Future Config Keys (Forward-Compatibility Break)

**What goes wrong:**
Adding new fields to `.kodiai.yml` in a newer Kodiai version causes existing repos with older configs to work fine, but repos that adopt a newer schema field and then encounter an older Kodiai version (e.g., during a rollback) will have their configs rejected. More critically, the *current* codebase already applies `.strict()` to `write`, `secretScan`, `mention`, and `review.triggers` sub-objects. This means adding ANY new key to those objects requires a coordinated deploy -- repos cannot adopt the new key until the new server is running.

**Why it happens:**
The codebase uses Zod `.strict()` on sub-objects (lines 41, 44, 82, 111 of `src/execution/config.ts`) which throws `ZodError` on unrecognized keys. The root schema is NOT strict (uses plain `z.object()`), so unknown top-level keys are silently stripped. But sub-object strictness means a repo adding `mention.maxTokens: 5000` before the server knows about that field will get `Invalid .kodiai.yml: mention: Unrecognized key(s) in object: 'maxTokens'`. This manifests as an error comment on every PR review and every mention -- effectively breaking the bot for that repo.

**Consequences:**
- Every review and mention for the repo fails with a config parse error
- Error comment posted on every PR (noisy, alarming)
- No way for the repo owner to fix it without reverting `.kodiai.yml` or waiting for the server update
- Rollback of Kodiai server version breaks repos that already adopted new config fields

**Prevention:**
1. **Remove `.strict()` from all user-facing sub-schemas.** Use `.passthrough()` or the default strip behavior instead. Strict validation is appropriate for internal/programmatic schemas, not user-authored config files that may evolve independently of the server version.
2. **Add a schema version field** (`schemaVersion: 1`) to the config. When the schema changes in a breaking way (rename/remove a field), bump the version. The parser can then apply version-specific parsing logic.
3. **Test forward-compatibility:** Add a test that parses a config with unknown keys in every sub-object and asserts it succeeds (unknown keys stripped, valid keys parsed).
4. **Document supported fields** so users know what is current vs. speculative.

**Detection:**
- Error comments containing "Unrecognized key(s) in object" appearing after a repo updates `.kodiai.yml`
- Support requests from repo owners who added a new field from documentation that was published before the server was updated

**Phase to address:** Config phase (first plan) -- must be fixed before adding any new config fields.

---

### Pitfall 2: Config Validation Errors Block Critical Paths (No Graceful Degradation)

**What goes wrong:**
`loadRepoConfig()` currently throws on any Zod validation error (`Invalid .kodiai.yml: ...`). This is caught in the handler's try/catch and surfaces as an error comment on the PR. But this means ANY config problem -- a typo, an invalid type, a value out of range -- completely prevents the review or mention from running. There is no partial parsing or fallback to defaults for valid sections.

For example, if a user writes `review.autoApprove: "yes"` (string instead of boolean), the ENTIRE config parse fails. The review does not run at all, even though the review section could have been parsed with defaults. A single typo in write-mode config prevents all reviews.

**Why it happens:**
Zod's `.parse()` is all-or-nothing. A single validation error in any nested field causes the entire parse to throw. The current code has no fallback strategy -- no attempt to parse with defaults for the failing section, no `safeParse()` with partial recovery.

**Consequences:**
- Bot becomes completely non-functional for a repo due to a single config typo
- Users may not realize their config is broken until they open a PR and see the error
- No way to "preview" config validity before committing

**Prevention:**
1. **Use two-pass parsing:** First, attempt `repoConfigSchema.parse()`. If it fails, attempt parsing each section independently with defaults for failed sections. Log warnings for fields that failed validation.
2. **Separate critical vs. non-critical config:** Review/mention enablement and basic settings are critical (worth failing on). New telemetry/reporting settings are non-critical (should degrade gracefully).
3. **Add a config validation endpoint or CLI tool** that repos can use to check their config before committing.
4. **Log the specific field that failed** (already done) but also continue with defaults for that section rather than aborting entirely.

**Detection:**
- Error comments on PRs containing "Invalid .kodiai.yml"
- Users reporting the bot "stopped working" after a config change

**Phase to address:** Config phase -- implement graceful degradation alongside new schema fields.

---

### Pitfall 3: Logging PII in Telemetry Records

**What goes wrong:**
Telemetry records capture execution metadata (repo, PR, cost, duration). It is tempting to also log the prompt, the PR body, comment content, or file paths for debugging. This inadvertently captures personally identifiable information (PII): author names, email addresses in commit messages, proprietary code snippets, and sensitive file paths (e.g., `secrets/production.env`). If telemetry is stored in SQLite on disk, this data persists indefinitely unless explicitly purged.

**Why it happens:**
Developers add "just a bit more context" to telemetry for debugging. The PR title, comment body, and file paths all seem harmless individually but collectively can identify individuals and expose proprietary information. The existing `Evidence bundle` log lines already include `owner`, `repo`, `prNumber`, `deliveryId`, and `reviewOutputKey` -- which is fine for structured logs with retention policies. But persisting this in a SQLite database with no retention policy changes the risk profile.

**Consequences:**
- Privacy violations if telemetry database is accessed by unauthorized parties
- Compliance issues (GDPR, SOC 2) if user content is stored without consent
- Storage bloat if full prompts/responses are logged (prompts can be 10KB+ per execution)
- Security risk if telemetry contains tokens, secrets, or sensitive file contents

**Prevention:**
1. **Define a strict telemetry schema** that contains ONLY: timestamp, repo owner/name (not full URLs), PR number, event type, job type, model name, token counts (input/output/cache), cost USD, duration ms, conclusion (success/failure/error), session ID. No free-text fields.
2. **Never log prompts, PR bodies, comment text, file contents, or file paths** in telemetry records. These belong in ephemeral structured logs (pino), not persistent storage.
3. **Redact before storage:** If any field could contain user content, pass it through the existing `sanitizeContent()` pipeline or, better, simply do not store it.
4. **Document what is collected:** Add a section to README or config docs explaining exactly what telemetry data is stored and retained.

**Detection:**
- Telemetry database contains rows with long text fields (>500 chars) suggesting prompt/body storage
- `grep` of telemetry insert statements showing user-content fields

**Phase to address:** Telemetry phase (schema design) -- define the allowlist of fields before writing any storage code.

---

### Pitfall 4: Unbounded Telemetry Storage Growth (SQLite File Grows Forever)

**What goes wrong:**
Every execution writes a telemetry row. With no retention policy, the SQLite database grows monotonically. At moderate usage (10-20 PRs/day across installed repos), this accumulates ~7,000 rows/year. The rows themselves are small (~500 bytes each), so raw data growth is modest (~3.5 MB/year). However, SQLite WAL files can grow independently of the main database, and without periodic checkpointing, the WAL can reach hundreds of MB. On Azure Container Apps with limited disk (the container filesystem is ephemeral on restart), this can consume the available tmpfs or overlay space.

**Why it happens:**
- No `DELETE` or `VACUUM` ever runs against telemetry data
- WAL mode (recommended for concurrent read/write) can grow unbounded if long-running reads prevent checkpointing
- Container restarts lose the database entirely (ephemeral filesystem), creating a false sense of "it never grows" -- until you move to persistent storage

**Consequences:**
- Disk space exhaustion in the container (especially problematic since Kodiai also creates ephemeral workspace clones)
- Slow queries on unindexed tables as row count grows
- WAL file growth causing write stalls if auto-checkpoint is starved
- Total data loss on container restart if using ephemeral filesystem

**Prevention:**
1. **Implement retention policy from day one:** `DELETE FROM telemetry WHERE timestamp < datetime('now', '-90 days')` on a periodic timer (daily or on startup).
2. **Run `PRAGMA wal_checkpoint(TRUNCATE)` periodically** (e.g., after cleanup) to reset WAL file size.
3. **Use a persistent volume** for the SQLite file (Azure Files mount on the container app), not the ephemeral container filesystem. Without this, all telemetry is lost on every deploy.
4. **Add a startup migration** that creates the table if it does not exist (idempotent schema). This handles both fresh deploys and version upgrades.
5. **Cap WAL size:** Set `PRAGMA wal_autocheckpoint = 1000` (checkpoint every 1000 pages, ~4MB) to prevent unbounded WAL growth.
6. **Monitor database size:** Log the file size on startup and periodically. Alert if it exceeds a threshold (e.g., 100MB).

**Detection:**
- `ls -la` showing telemetry.db growing beyond expected size
- Container logs showing disk space warnings
- Telemetry queries becoming slow (>100ms for simple aggregations)

**Phase to address:** Storage phase -- retention policy must be part of the initial storage implementation, not a later addition.

---

## Moderate Pitfalls

### Pitfall 5: Cost Estimation Drift When Anthropic Changes Pricing

**What goes wrong:**
The Agent SDK provides `total_cost_usd` in the result message, which is authoritative and accurate at the time of the API call. However, if you also compute costs locally (e.g., for projections or budgets), hardcoded per-token prices will silently become wrong when Anthropic changes pricing. This has happened multiple times: Claude Opus 4.5 was 67% cheaper than its predecessor. Any cost calculations using stale rates will diverge from actual bills.

**Why it happens:**
Anthropic updates pricing with new model releases. The SDK's `total_cost_usd` reflects current pricing, but any locally stored rate tables or formulas do not auto-update.

**Prevention:**
1. **Use `total_cost_usd` from the SDK result as the authoritative cost.** Do not compute costs locally from token counts. Store the SDK-reported cost directly in telemetry.
2. **Store token counts alongside cost** so you can re-compute if rates change, but always treat the SDK value as ground truth.
3. **Store the model name** with each telemetry record so cost-per-model reports remain meaningful when models change.
4. **Do not hardcode pricing tables** for display or budgeting. If you need to show rates, fetch them or clearly label them as approximate.

**Detection:**
- Cost reports showing $0.00 for executions (SDK returned undefined/null for errored runs)
- Locally computed costs diverging from Anthropic billing dashboard

**Phase to address:** Telemetry phase -- record SDK cost directly, avoid local computation.

---

### Pitfall 6: Telemetry Collection Blocking the Critical Path (Execution Slowdown)

**What goes wrong:**
If telemetry storage (SQLite write) is in the critical path between execution completion and the next job starting, a slow or failing database write delays the entire job pipeline. Since Kodiai uses per-installation concurrency of 1 (via p-queue), a 500ms database write adds 500ms to every job's total latency. If the database write fails (disk full, permissions, corruption), the job appears to fail even though the actual review/mention succeeded.

**Why it happens:**
The natural place to add telemetry is at the end of the executor's `execute()` method or in the handler after `executor.execute()` returns. Both locations are inside the p-queue job callback, meaning telemetry write time is added to total job time.

**Prevention:**
1. **Make telemetry writes fire-and-forget within the job callback.** Use `void writeTelemetry(record).catch(err => logger.warn({err}, "Telemetry write failed"))` -- never `await` it in the critical path.
2. **Or: write telemetry outside the queue.** The handler `enqueue()` call returns the result. After the queue resolves, write telemetry. But this is trickier with the current architecture where the handler is inside the callback.
3. **Use an in-memory buffer** that flushes to SQLite periodically (e.g., every 10 seconds or every 10 records). This decouples write latency from job latency.
4. **Handle storage failures gracefully:** A telemetry write failure must NEVER prevent a review from being posted or a mention from being answered. Log the failure, continue.

**Detection:**
- Job durations increasing after telemetry is added (compare before/after)
- Telemetry write errors causing job failures in logs

**Phase to address:** Telemetry phase -- design the write path as non-blocking from the start.

---

### Pitfall 7: Schema Migration Breaks Existing `.kodiai.yml` Files

**What goes wrong:**
Renaming or restructuring config fields breaks existing `.kodiai.yml` files across all installed repos. For example, renaming `review.autoApprove` to `review.silentApproval` would break every repo that has the old field name. Since Kodiai reads `.kodiai.yml` from the target repo at execution time, there is no opportunity to migrate configs before they are parsed.

**Why it happens:**
Unlike a server-side database where you control migrations, `.kodiai.yml` lives in user repositories. You cannot migrate these files -- they update on the users' schedule, if ever. The server must support all historical config shapes indefinitely (or until explicitly deprecated).

**Consequences:**
- All repos with the old field name get config errors on every PR
- Users must be notified and must update their configs manually
- The server must either support both old and new field names or break backward compatibility

**Prevention:**
1. **Never rename or remove config fields.** Add new fields alongside old ones. Deprecate via documentation, not removal.
2. **Use Zod `.transform()` for field aliases:** If you must rename a field, add the new name and use a transform that reads the old name as a fallback. For example:
   ```typescript
   // Support both old and new names
   z.object({
     silentApproval: z.boolean().optional(),
     autoApprove: z.boolean().optional(),  // deprecated alias
   }).transform(obj => ({
     silentApproval: obj.silentApproval ?? obj.autoApprove ?? true,
   }))
   ```
3. **Test backward compatibility:** Maintain a set of "golden" config files representing configs from each schema version. Run them through the parser on every build.
4. **Add a `schemaVersion` field** to configs. Default to 1 (implicit). When breaking changes are unavoidable, check the version and apply version-specific parsing.

**Detection:**
- Config parse errors appearing across multiple repos simultaneously after a deploy
- Error messages containing old field names

**Phase to address:** Config phase -- establish the migration strategy before adding new fields.

---

### Pitfall 8: SQLite Database Locked Under Concurrent Access

**What goes wrong:**
Bun's `bun:sqlite` is synchronous (like `better-sqlite3`). If a long-running telemetry query (e.g., a CLI report generating aggregations over months of data) holds a read transaction while a webhook handler tries to write a new telemetry row, the write will get `SQLITE_BUSY`. In WAL mode, readers do not block writers in most cases, but `PRAGMA wal_checkpoint(TRUNCATE)` requires exclusive access and will block or fail if any readers are active.

**Why it happens:**
The Kodiai server (handling webhooks) and the CLI reporting tool (generating reports) may access the same SQLite file simultaneously. SQLite handles this well in WAL mode for simple cases, but edge cases (checkpoint, vacuum, schema changes) can cause contention.

**Prevention:**
1. **Enable WAL mode** (`PRAGMA journal_mode = WAL`) at database creation time. This allows concurrent reads during writes.
2. **Use short transactions for writes:** The telemetry insert should be a single `INSERT` statement, not wrapped in a long transaction.
3. **Set a busy timeout:** `PRAGMA busy_timeout = 5000` (5 seconds) so writes retry instead of immediately failing with SQLITE_BUSY.
4. **Run checkpoint and cleanup on startup or during quiet periods**, not while the server is actively processing webhooks.
5. **CLI reporting tool should use read-only mode** if bun:sqlite supports it, or use short-lived connections with `PRAGMA query_only = ON`.

**Detection:**
- `SQLITE_BUSY` errors in server logs
- CLI reports failing with "database is locked"
- WAL file growing very large (checkpoint unable to complete)

**Phase to address:** Storage phase -- configure WAL mode and busy timeout in the database initialization code.

---

### Pitfall 9: Telemetry for Errored/Timed-Out Executions Losing Partial Data

**What goes wrong:**
When an execution errors or times out, the Agent SDK may not return `total_cost_usd`, `num_turns`, or `session_id` (they are `undefined` in the `ExecutionResult`). If the telemetry layer requires these fields or skips writing when they are undefined, errored executions have no telemetry record. This makes it impossible to answer questions like "how much did failed executions cost this month?" or "what is our error rate?"

**Why it happens:**
The current `ExecutionResult` type already handles this -- `costUsd`, `numTurns`, and `sessionId` are `undefined` for error cases (see `executor.ts` lines 148-151, 178-181, 194-197). But a telemetry schema that uses `NOT NULL` constraints on these columns, or a CLI report that filters out rows where `cost_usd IS NULL`, will silently exclude error records.

**Prevention:**
1. **Make cost/turns/session nullable in the telemetry schema.** Use `REAL` (not `REAL NOT NULL`) for cost_usd. Use `INTEGER` (nullable) for num_turns.
2. **Always write a telemetry record for every execution**, including errors and timeouts. The `conclusion` field (`success`/`failure`/`error`) distinguishes them.
3. **For timed-out executions, record the elapsed time** from `Date.now() - startTime` even though the SDK did not report `duration_ms`.
4. **Include an `error_category` field** (timeout, config_error, api_error, unknown) for filtering and aggregation.

**Detection:**
- Telemetry row count diverging from log line count for "Execution completed" vs "Execution failed"
- Cost reports showing lower-than-expected totals (errored executions not counted)
- Error rate appearing as 0% because errors are not recorded

**Phase to address:** Telemetry phase -- schema design must accommodate nullable fields from the start.

---

## Minor Pitfalls

### Pitfall 10: Adding Config Fields Without Default Values Breaks Zero-Config Repos

**What goes wrong:**
Repos without a `.kodiai.yml` file rely on `repoConfigSchema.parse({})` returning sensible defaults (see `config.ts` line 124). Adding a new required field without a default causes this parse to fail, breaking every repo that does not have a config file.

**Prevention:**
Every new config field MUST have a `.default()` value. This is already the pattern in the codebase (every field has a default), but it must be enforced as a rule. Add a test: `repoConfigSchema.parse({})` succeeds and returns expected defaults for all fields including new ones.

**Phase to address:** Config phase -- enforce in code review and tests.

---

### Pitfall 11: CLI Reporting Script Importing Server Modules (Coupling)

**What goes wrong:**
The reporting CLI script needs to read the telemetry database and format reports. If it imports modules from the server codebase (e.g., types, config), it creates a coupling that makes the CLI script dependent on server dependencies (Hono, Octokit, Agent SDK). This bloats the CLI and creates import errors if dependencies are not available in the CLI context.

**Prevention:**
1. **Keep the telemetry types in a shared, dependency-free module** (e.g., `src/telemetry/types.ts`) that both the server and CLI can import.
2. **The CLI script should only depend on bun:sqlite and minimal formatting utilities.** It should NOT import from handlers, execution, or webhook modules.
3. **Place the CLI script in `scripts/` (already the convention)** and ensure it has its own minimal import graph.

**Phase to address:** Reporting phase -- structure the module boundary before writing the CLI.

---

### Pitfall 12: Losing Telemetry on Container Restart (Ephemeral Filesystem)

**What goes wrong:**
Azure Container Apps use an ephemeral overlay filesystem by default. The SQLite database file is lost on every container restart, deploy, or scale event. Since Kodiai deploys frequently (38 plans shipped in the first milestone alone), telemetry data would be lost on every deploy.

**Prevention:**
1. **Mount a persistent Azure Files volume** to the container app. Store the SQLite database on this volume (e.g., `/data/telemetry.db`).
2. **Alternatively, use a JSON-lines file** on the persistent volume as a simpler alternative to SQLite. Append-only, no WAL concerns, trivially backed up. Parse with `jq` for reporting.
3. **Configure the storage path via environment variable** (e.g., `TELEMETRY_DB_PATH`) so it works in both local dev (ephemeral) and production (persistent volume).
4. **Add startup logging** that reports whether the telemetry database exists and its current size/row count.

**Detection:**
- Telemetry database is empty after every deploy
- Row count never exceeds what was created since last restart

**Phase to address:** Storage phase -- persistent volume must be configured before telemetry has production value.

---

### Pitfall 13: Config Schema Changes Not Covered by Existing Tests

**What goes wrong:**
The existing test suite (`config.test.ts`) validates specific field combinations but does not systematically test forward/backward compatibility. Adding new fields without updating tests means regressions are caught in production, not CI.

**Prevention:**
1. **Add a "golden config" test:** Parse a config file representing every supported field with valid values. Assert the parse succeeds and all fields have expected values.
2. **Add a "minimal config" test:** Parse `{}` and assert every field has its expected default. (This already exists but should be updated as fields are added.)
3. **Add a "future config" test:** Parse a config with unknown keys in every sub-object and assert it succeeds (after removing `.strict()`).
4. **Add a "deprecated field" test:** When fields are deprecated, verify the alias/transform still works.

**Phase to address:** Config phase -- update test suite alongside schema changes.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Config schema expansion | Strict sub-schemas reject new keys (Pitfall 1) | Remove `.strict()` from user-facing schemas before adding fields |
| Config schema expansion | No graceful degradation (Pitfall 2) | Implement section-level fallback parsing |
| Config schema expansion | Breaking existing configs (Pitfall 7) | Never rename/remove fields; use aliases |
| Config schema expansion | Zero-config repos break (Pitfall 10) | Every new field must have `.default()` |
| Telemetry collection | PII in telemetry records (Pitfall 3) | Define strict field allowlist; no free-text |
| Telemetry collection | Blocking critical path (Pitfall 6) | Fire-and-forget writes; never await in job |
| Telemetry collection | Errored executions not recorded (Pitfall 9) | Nullable cost/turns fields; always write |
| Telemetry collection | Cost drift from pricing changes (Pitfall 5) | Use SDK `total_cost_usd` directly; store model name |
| Persistent storage | Unbounded growth (Pitfall 4) | 90-day retention + WAL checkpoint on day 1 |
| Persistent storage | Data loss on restart (Pitfall 12) | Azure Files persistent volume |
| Persistent storage | Database locking (Pitfall 8) | WAL mode + busy_timeout + short transactions |
| CLI reporting | Module coupling (Pitfall 11) | Shared types module; CLI has minimal imports |
| Test coverage | Regressions from schema changes (Pitfall 13) | Golden config + future config + minimal config tests |

## Integration Pitfalls: How New Features Break Existing Behavior

These are specific to adding config + telemetry to the EXISTING Kodiai system.

| Integration Point | Risk | Prevention |
|---|---|---|
| `loadRepoConfig()` adding new fields | Existing `.kodiai.yml` files with typos in new field names fail completely | Graceful degradation: parse valid sections, warn on invalid |
| Telemetry write in `executor.execute()` | Import of `bun:sqlite` at module level slows server startup | Lazy-initialize database connection on first write |
| Telemetry write in handler callbacks | Write failure propagates as job failure | Wrap in try/catch with logger.warn, never throw |
| SQLite database on container filesystem | Every deploy loses data | Persistent volume mount required for production value |
| CLI script importing from `src/` | CLI breaks when server dependencies change | Shared types module with no server dependencies |
| New config sections (e.g., `telemetry.enabled`) | Existing repos with no `.kodiai.yml` must still work | Ensure `repoConfigSchema.parse({})` succeeds with all defaults |

## Sources

- Kodiai codebase inspection: `src/execution/config.ts` (strict sub-schemas), `src/execution/executor.ts` (cost tracking from SDK), `src/handlers/review.ts` and `src/handlers/mention.ts` (telemetry logging points) -- HIGH confidence (direct inspection)
- [Zod `.strict()` forward-compatibility issue (opencode #6145)](https://github.com/anomalyco/opencode/issues/6145) -- HIGH confidence (real-world case study of exact same problem)
- [Zod v4 Migration Guide](https://zod.dev/v4/changelog) -- HIGH confidence (official docs)
- [Claude Agent SDK: Tracking Costs and Usage](https://platform.claude.com/docs/en/agent-sdk/cost-tracking) -- HIGH confidence (official Anthropic docs, verified `total_cost_usd` is authoritative)
- [Anthropic Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) -- HIGH confidence (official pricing page)
- [SQLite WAL Mode Documentation](https://sqlite.org/wal.html) -- HIGH confidence (official SQLite docs)
- [Bun SQLite Runtime Documentation](https://bun.com/docs/runtime/sqlite) -- HIGH confidence (official Bun docs)
- [Litestream WAL Truncate Threshold Guide](https://litestream.io/guides/wal-truncate-threshold/) -- MEDIUM confidence (well-documented OSS tool)
- [Keep PII Out of Your Telemetry (OneUptime)](https://oneuptime.com/blog/post/2025-11-13-keep-pii-out-of-observability-telemetry/view) -- MEDIUM confidence (industry best practices)
- [Microsoft Engineering Playbook: Privacy in Logging](https://microsoft.github.io/code-with-engineering-playbook/observability/logs-privacy/) -- MEDIUM confidence (engineering best practices)

---
*Pitfalls research for: Kodiai v0.3 Enhanced Config + Telemetry*
*Researched: 2026-02-11*
