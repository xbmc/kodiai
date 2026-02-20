# Kodiai Code Review

## Summary

- **Files reviewed:** 97 non-test TypeScript source files
- **Total lines:** ~23,570
- **Directories:** 15 (`handlers`, `execution`, `execution/mcp`, `lib`, `slack`, `knowledge`, `learning`, `jobs`, `enforcement`, `telemetry`, `webhook`, `routes`, `feedback`, `auth`, `api`, `types`, plus root `src/`)

### Finding Counts by Severity

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 12 |
| Medium | 18 |
| Low | 10 |

---

## Critical (Bugs, Security, Data Loss Risk)

### C-1. Hardcoded repository default in Slack repo-context exposes wrong repo data

- **File:** `src/slack/repo-context.ts:7`
- **Description:** `DEFAULT_REPO` is hardcoded to `"xbmc/xbmc"` -- a public third-party repository. If a Slack user sends a message without an explicit repo reference, Kodiai will resolve context against xbmc/xbmc rather than the user's intended repository. This could cause the assistant to return code analysis from a completely unrelated codebase.
- **Impact:** Incorrect code review output, information leakage from wrong repo, user confusion.
- **Also appears in:** `src/slack/assistant-handler.ts:~180` (instant reply mentions "repo: xbmc/xbmc").
- **Suggested fix:** Remove the hardcoded default. Either require explicit repo context in every Slack message, or resolve the default from the GitHub App's installed repositories (e.g., use the first/only installed repo, or prompt the user to choose).

### C-2. Thread session store has no TTL, size cap, or eviction -- unbounded memory growth

- **File:** `src/slack/thread-session-store.ts:1-35`
- **Description:** `ThreadSessionStore` uses a plain `Map<string, ThreadSession>` with no maximum size, no TTL-based eviction, and no periodic cleanup. Every new Slack thread creates an entry that persists for the lifetime of the process. Over time, this grows without bound.
- **Impact:** Memory leak leading to OOM crash on long-running deployments. The longer the server runs, the more memory is consumed by stale session entries that will never be accessed again.
- **Suggested fix:** Add a `maxEntries` cap with LRU eviction, or add a TTL (e.g., 24 hours) with a periodic cleanup interval. The `webhook/dedup.ts` module already implements TTL-based eviction and could serve as a pattern.

### C-3. Write confirmation store has no cleanup of expired entries

- **File:** `src/slack/write-confirmation-store.ts:1-85`
- **Description:** The `WriteConfirmationStore` stores write confirmations with a 5-minute TTL but only checks TTL on `get()`. Entries that are never retrieved are never deleted. The `pruneExpired()` method exists but is never called from any consumer.
- **Impact:** Slow memory leak. While each entry is small, over months of operation with frequent write-mode usage, stale entries accumulate indefinitely.
- **Suggested fix:** Either call `pruneExpired()` on a periodic timer (e.g., every 10 minutes), or call it opportunistically from `set()` when the map exceeds a threshold size.

---

## High (Error Handling, Race Conditions, Performance)

### H-1. Webhook deduplicator has no size cap -- memory grows proportional to webhook volume

- **File:** `src/webhook/dedup.ts:1-41`
- **Description:** The deduplicator uses a `Map<string, number>` that grows with every webhook delivery. While `isRecent()` evicts entries older than 24 hours, eviction only runs when a specific delivery is checked. Under high webhook volume, the map can grow very large between eviction cycles.
- **Impact:** Memory pressure under sustained high webhook throughput (thousands of events per hour). The linear scan on each `add()` call (via the eviction loop) also degrades to O(n) performance.
- **Suggested fix:** Add a `maxSize` cap (e.g., 50,000 entries). When exceeded, evict oldest entries proactively. Alternatively, use a time-bucketed approach that allows O(1) bulk eviction.

### H-2. Job queue per-installation Map never evicts idle installations

- **File:** `src/jobs/queue.ts:20-132`
- **Description:** `installationQueues` is a `Map<number, PQueue>` that creates a new PQueue for each installation ID and never removes them. For a SaaS bot installed on hundreds of organizations, each installation gets a permanent PQueue allocation.
- **Impact:** Minor memory leak, but PQueue instances hold internal state. On a multi-tenant deployment with many installations, this grows unbounded.
- **Suggested fix:** Add an idle timeout that removes PQueue instances after a period of inactivity (e.g., 1 hour with no jobs).

### H-3. Slack installation cache has no TTL or size limit

- **File:** `src/index.ts:178`
- **Description:** `slackInstallationCache` is a `Map<string, { installationId: number; defaultBranch: string }>` defined at module scope with no TTL or size cap. Cached entries persist forever, meaning a repository whose default branch changes (e.g., `master` -> `main`) will use stale data until the process restarts.
- **Impact:** Stale `defaultBranch` values lead to Slack write operations targeting the wrong branch. Cache entries never expire even if the GitHub App is uninstalled from a repo.
- **Suggested fix:** Add a TTL (e.g., 1 hour) to cache entries, or use the same `SearchCache` pattern from `src/lib/search-cache.ts` which already supports TTL.

### H-4. `console.warn` used instead of structured logger in enforcement

- **File:** `src/enforcement/tooling-detection.ts:76,97`
- **Description:** Two instances of `console.warn()` are used for error logging instead of the structured Pino logger used everywhere else in the codebase. These errors (file read failures during tooling detection) bypass all log aggregation and structured metadata.
- **Impact:** Errors are invisible to structured log consumers (e.g., Azure Application Insights). Inconsistent logging makes debugging harder.
- **Suggested fix:** Pass `logger` as a parameter to `detectToolingConfigs()` and use `logger.warn()` instead of `console.warn()`.

### H-5. `any` casts in dependency bump enrichment bypass type safety

- **File:** `src/lib/dep-bump-enrichment.ts:35,58,120,180`
- **Description:** Multiple `as any` casts are used when accessing Octokit REST API response data. For example: `(response as any).data`, `(item as any).severity`. This bypasses TypeScript's type checking for GitHub API responses.
- **Impact:** Runtime errors if the GitHub API response shape changes. No compile-time safety for field access on API responses.
- **Suggested fix:** Use proper Octokit type generics or define explicit response types. The `@octokit/webhooks-types` package is already in use and could provide typed responses.

### H-6. review.ts is a 3,760-line god file with mixed responsibilities

- **File:** `src/handlers/review.ts:1-3760`
- **Description:** This single file contains: review handler registration, PR event processing, author tier resolution, search rate limit handling, finding extraction/processing/recording, checkpoint management, timeout/retry logic, dep-bump enrichment orchestration, learning memory retrieval, idempotency checking, and review details formatting. At least 15 distinct responsibilities in one file.
- **Impact:** Extremely difficult to test individual components. Changes to one concern risk breaking others. New developers face a steep learning curve. Function extraction is blocked by deep coupling.
- **Suggested fix:** Extract into focused modules: `review-pipeline.ts` (orchestration), `review-findings.ts` (extraction/processing), `review-author.ts` (tier resolution), `review-checkpoint.ts` (checkpoint/retry), `review-details.ts` (formatting). Keep the handler registration thin.

### H-7. mention.ts is a 2,023-line handler with similar god-file concerns

- **File:** `src/handlers/mention.ts:1-2023`
- **Description:** Similar to review.ts, this file contains mention event handling, write-mode orchestration, context building, and comment management all in one file.
- **Impact:** Same maintainability and testability concerns as review.ts, though less severe due to smaller size.
- **Suggested fix:** Extract write-mode orchestration and context building into separate modules.

### H-8. Telemetry purge uses RETURNING clause but only counts length

- **File:** `src/telemetry/store.ts:439-454`
- **Description:** `purgeOlderThan()` uses `RETURNING id` and then calls `.all()` to get all deleted rows, but only uses the `.length` property. This means SQLite materializes all deleted row IDs in memory before returning.
- **Impact:** For large purges (thousands of rows), this allocates unnecessary memory. With 90-day retention and high-volume telemetry, purge operations could delete tens of thousands of rows.
- **Suggested fix:** Use `db.run()` instead of `db.query().all()` with RETURNING, and check `result.changes` for the count -- as is already done correctly in `knowledge/store.ts:purgeOldRuns`.

### H-9. Rate-limit failure injection identities: type mismatch between array and Set

- **File:** `src/index.ts:52-55` vs `src/telemetry/store.ts:362`
- **Description:** In `index.ts`, `rateLimitFailureInjectionIdentities` is constructed as an `Array<string>` (via `.split().map().filter()`). In `telemetry/store.ts:362`, it is accessed via `.has()` -- a Set method. This means the telemetry store factory expects a `Set<string>` but receives an `Array<string>`.
- **Impact:** `Array.prototype.has` does not exist in JavaScript. This code path would throw a TypeError at runtime if failure injection is enabled. However, this is a testing/verification feature so it may not be triggered in production.
- **Suggested fix:** Convert to `new Set(rateLimitFailureInjectionIdentities)` in `index.ts` before passing to the telemetry store, or change the store to accept an array and use `.includes()`.

### H-10. No rate limiting on Slack event processing

- **File:** `src/routes/slack-events.ts:1-135`
- **Description:** The Slack event route has deduplication (via delivery ID) but no rate limiting. A malicious or misbehaving Slack integration could flood the endpoint with unique events, each spawning a full assistant handler execution including LLM calls.
- **Impact:** Uncapped LLM API spend, potential resource exhaustion, denial of service to legitimate users.
- **Suggested fix:** Add a rate limiter per channel or per user (e.g., max 10 requests per minute per channel). The Hono middleware ecosystem has rate-limiting packages, or a simple token-bucket can be implemented.

### H-11. Workspace cleanup race condition during concurrent PR events

- **File:** `src/jobs/workspace.ts:50-70`
- **Description:** Workspace creation uses `mkdtemp` and cleanup uses `rm -rf`. If two events for the same PR arrive near-simultaneously, the job queue's per-installation concurrency of 1 prevents concurrent execution within an installation, but events across different installations sharing the same temp directory root could race on cleanup.
- **Impact:** Low probability but possible orphaned temp directories or premature cleanup if directory names collide.
- **Suggested fix:** The current `mkdtemp` approach makes collisions extremely unlikely. This is a theoretical concern. Adding a workspace lock file would add complexity without clear benefit.

### H-12. execution/config.ts has highly repetitive section-by-section parsing

- **File:** `src/execution/config.ts:400-705`
- **Description:** The `parseRepoConfigLenient` function repeats the same pattern ~15 times: parse with Zod, check success, fallback to default, push warnings. Each section follows an identical structure with only the schema and field name varying.
- **Impact:** ~300 lines of near-identical code. Adding a new config section requires copying the same pattern. Bugs in the pattern must be fixed in all 15 copies.
- **Suggested fix:** Extract a generic helper: `function parseSectionLenient<T>(schema: ZodSchema<T>, value: unknown, section: string, warnings: Warning[]): T`.

---

## Medium (Architecture, Type Safety, Maintainability)

### M-1. Duplicate FindingSeverity / FindingCategory type definitions

- **File:** `src/handlers/review.ts:83-85` vs `src/knowledge/types.ts:~50-60`
- **Description:** `FindingSeverity`, `FindingCategory`, and `ConfidenceBand` are defined locally in review.ts as string literal unions, and also defined in `knowledge/types.ts`. The two definitions are identical but independent -- changes to one do not propagate to the other.
- **Impact:** Type drift risk. If one definition adds a new severity level, the other remains stale.
- **Suggested fix:** Import from `knowledge/types.ts` in review.ts instead of redefining.

### M-2. Slack client has no timeout on HTTP requests

- **File:** `src/slack/client.ts:1-144`
- **Description:** The Slack client uses `fetch()` for all API calls without specifying `AbortSignal.timeout()` or any timeout mechanism. If the Slack API becomes unresponsive, these calls block indefinitely.
- **Impact:** Hung requests consume resources and block the Slack handler from processing other events.
- **Suggested fix:** Add `signal: AbortSignal.timeout(10_000)` to all fetch calls.

### M-3. Slack signature verification timing-safe comparison uses string-to-buffer conversion

- **File:** `src/slack/verify.ts:30-45`
- **Description:** The implementation correctly uses `crypto.timingSafeEqual` for comparing signatures, which is good. However, the function converts both hex strings to `Buffer` before comparison, which is standard practice. No issue here -- this is well-implemented.
- **Impact:** None (positive observation, included for completeness).

### M-4. Knowledge store uses 12+ prepared statements without connection pooling

- **File:** `src/knowledge/store.ts:1-1212`
- **Description:** The knowledge store creates many prepared statements upfront and holds a single SQLite connection for the process lifetime. This is correct for Bun's single-threaded model with SQLite, but the sheer number of prepared statements (~20+) creates a large initialization surface.
- **Impact:** Minor -- increased startup time and memory for prepared statement caches. Not a bug, but worth noting the complexity.
- **Suggested fix:** Consider grouping related statements into sub-modules (e.g., review statements, feedback statements, run-state statements).

### M-5. Learning memory store uses raw SQL string concatenation for vector search

- **File:** `src/learning/memory-store.ts:180-220`
- **Description:** The vector similarity search query is built with template literals embedding the dimension count. While the dimension is a controlled integer from config (not user input), the pattern of embedding values in SQL strings rather than parameterizing them is fragile.
- **Impact:** Low risk since the value is server-controlled, but inconsistent with the parameterized query style used elsewhere.
- **Suggested fix:** Use a parameterized query if sqlite-vec supports it for the distance function.

### M-6. Adaptive threshold minimum-candidate guard could mask retrieval issues

- **File:** `src/learning/adaptive-threshold.ts:35-40`
- **Description:** When there are fewer than 8 candidates, the function falls back to the configured threshold without logging or telemetry. This makes it impossible to distinguish "no relevant memories exist" from "adaptive threshold could not activate due to insufficient candidates."
- **Impact:** Debugging retrieval quality issues is harder when the adaptive path silently skips.
- **Suggested fix:** Add a log at debug level when the guard activates, including candidate count and configured threshold.

### M-7. Multi-query retrieval variant construction builds redundant queries

- **File:** `src/learning/multi-query-retrieval.ts:30-80`
- **Description:** `buildRetrievalVariants` generates multiple query variants (severity-focused, file-focused, etc.) that may substantially overlap in content. Each variant triggers a separate embedding generation call to VoyageAI.
- **Impact:** Redundant API calls increase latency and cost. With 3-4 variants per review, this multiplies embedding costs.
- **Suggested fix:** Consider deduplicating variants by content similarity before sending to the embedding API, or use a single combined query with weighted terms.

### M-8. Sanitizer TOCTOU filter has a 10-second debounce window

- **File:** `src/lib/sanitizer.ts:155-180`
- **Description:** The TOCTOU (Time-of-Check-Time-of-Use) filter prevents duplicate content from being posted within a 10-second window. This uses an in-memory Map with no size cap.
- **Impact:** Like other in-memory Maps in the codebase, this grows without bound. Under high volume, old entries accumulate.
- **Suggested fix:** Add a periodic cleanup or max-size cap. The entries are small (hash -> timestamp), so this is low priority.

### M-9. File risk scorer uses magic numbers without named constants

- **File:** `src/lib/file-risk-scorer.ts:50-120`
- **Description:** Weight values (0.35, 0.25, 0.20, 0.10, 0.10) and threshold numbers (1000, 500, 200, 100) are embedded directly in the scoring logic without named constants or configuration.
- **Impact:** Tuning the risk scoring algorithm requires modifying hardcoded values scattered through the function body.
- **Suggested fix:** Extract weights and thresholds into named constants at the top of the file or into a config object.

### M-10. Enforcement severity floors use hardcoded built-in patterns

- **File:** `src/enforcement/severity-floors.ts:20-100`
- **Description:** Built-in enforcement patterns (e.g., SQL injection detection, XSS detection) are hardcoded as arrays of regex patterns and string literals. These cannot be extended by users without modifying source code.
- **Impact:** Users cannot customize enforcement rules for their specific codebase patterns.
- **Suggested fix:** This is a design choice (not a bug). Consider allowing user-defined patterns in `.kodiai.yml` in a future version.

### M-11. Workspace manager secret scanning regex could have false positives

- **File:** `src/jobs/workspace.ts:~400-450`
- **Description:** Secret scanning uses regex patterns to detect API keys, tokens, and credentials in git diffs. Patterns like `/[A-Za-z0-9]{32,}/` can match non-secret strings (e.g., UUIDs, hashes, base64-encoded data).
- **Impact:** False positive secret detection could block legitimate write-mode operations.
- **Suggested fix:** Tighten patterns with prefix matching (e.g., require `sk-`, `ghp_`, `AKIA` prefixes for known token formats). Add an escape hatch in config for known false positives.

### M-12. PR intent parser keyword matching is case-insensitive but not Unicode-aware

- **File:** `src/lib/pr-intent-parser.ts:40-80`
- **Description:** Keyword matching uses `.toLowerCase()` which handles ASCII case but not locale-specific case folding (e.g., Turkish dotted/dotless I).
- **Impact:** Negligible in practice -- PR titles are overwhelmingly in English/ASCII. Noted for completeness.

### M-13. Review prompt construction builds very large system prompts

- **File:** `src/execution/review-prompt.ts:1-1701`
- **Description:** The review prompt builder concatenates many sections (diff context, prior findings, learning memory, enforcement rules, language rules, path instructions) into a single system prompt that can exceed 100K characters for large PRs.
- **Impact:** High token consumption per review. Near the context window limit for some models. No explicit guard against exceeding model context limits.
- **Suggested fix:** Add a total-characters budget with graceful truncation of lower-priority sections when the budget is exceeded.

### M-14. Search cache TTL is applied per-key but cleanup is passive

- **File:** `src/lib/search-cache.ts:1-194`
- **Description:** Cache entries expire based on TTL checked during `get()`, but expired entries remain in the Map until accessed. No periodic cleanup.
- **Impact:** Minor memory overhead from expired-but-uncollected cache entries.
- **Suggested fix:** Low priority. Could add an optional `cleanup()` method or size cap.

### M-15. Bot filter allowList matching uses exact string comparison

- **File:** `src/webhook/filters.ts:20-30`
- **Description:** The bot allowlist compares usernames with exact string matching. Bot usernames are case-sensitive in the filter but GitHub usernames are case-insensitive.
- **Impact:** A bot with username `MyBot` would not match an allowlist entry of `mybot`.
- **Suggested fix:** Normalize both sides to lowercase before comparison.

### M-16. MCP comment server has extensive regex-based response validation

- **File:** `src/execution/mcp/comment-server.ts:100-500`
- **Description:** The comment server validates LLM-generated content against multiple regex patterns to ensure proper formatting (section headers, severity tags, collapsible blocks). This validation logic is complex and tightly coupled to the expected output format.
- **Impact:** If the LLM output format changes slightly, validation silently strips content. Debugging why content was stripped requires understanding many regex patterns.
- **Suggested fix:** Consider logging when validation strips content, at debug level, to aid troubleshooting.

### M-17. Feedback confidence adjustment uses fixed linear weights

- **File:** `src/feedback/confidence-adjuster.ts:7-14`
- **Description:** The formula `baseConfidence + (thumbsUp * 10) - (thumbsDown * 20)` uses fixed weights. A single thumbs-down reduces confidence by 20 points, which is aggressive. Three thumbs-down on an otherwise high-confidence finding would reduce it from 100 to 40.
- **Impact:** Aggressive downweighting could suppress legitimate findings after a small number of negative reactions. The 2x asymmetry (down=20 vs up=10) means recovery from false negatives is slow.
- **Suggested fix:** Consider making the weights configurable or using diminishing returns (e.g., logarithmic scaling).

### M-18. Health endpoint returns minimal information

- **File:** `src/routes/health.ts:1-34`
- **Description:** The health endpoint returns `{ status: "ok" }` with no details about subsystem health (database connectivity, GitHub App auth status, embedding provider status).
- **Impact:** Load balancers and monitoring systems cannot distinguish between "server is running" and "server is healthy and can process requests."
- **Suggested fix:** Add readiness checks for critical dependencies: SQLite databases are writable, GitHub App token is valid, Slack token is valid.

---

## Low (Style, Naming, Minor Improvements)

### L-1. Inconsistent error handling patterns: fail-open vs throw

- **Files:** Various across codebase
- **Description:** Some modules use fail-open (catch and return default), others throw. Both patterns are valid and contextually appropriate, but the decision of when to fail-open vs throw is not documented.
- **Suggested fix:** Add a comment or project-level doc explaining the fail-open policy: "Enrichment features fail-open; core review pipeline throws."

### L-2. `void Promise.resolve().then(...)` pattern for fire-and-forget

- **File:** `src/index.ts:120,180`
- **Description:** Two instances of `void Promise.resolve().then(async () => { ... })` for fire-and-forget async work (embeddings smoke test, Slack scope preflight). This is a valid pattern but unusual -- most codebases use `void (async () => { ... })()` or `setImmediate`.
- **Suggested fix:** Consistent and functional as-is. Could standardize on a `fireAndForget(fn, logger)` utility for clarity.

### L-3. Logger factory is minimal

- **File:** `src/lib/logger.ts:1-19`
- **Description:** The logger factory creates a Pino instance with only `level` and `transport` configuration. No request correlation IDs, no structured context defaults, no redaction of sensitive fields.
- **Suggested fix:** Low priority. Consider adding `redact: ['*.password', '*.token']` to prevent accidental secret logging.

### L-4. Picomatch type declaration could use `@types/picomatch`

- **File:** `src/types/picomatch.d.ts:1-12`
- **Description:** A manual type declaration exists for picomatch. The `@types/picomatch` package provides official types.
- **Suggested fix:** Install `@types/picomatch` and remove the manual declaration, if the official types are compatible.

### L-5. API directory contains only phase verification scripts

- **File:** `src/api/phase27-uat-example.ts`, `src/api/phase28-inline-suppression-live-check.ts`
- **Description:** The `src/api/` directory contains only test/verification scripts from past development phases, not actual API modules.
- **Suggested fix:** Move to a `scripts/` or `test/fixtures/` directory, or remove if no longer needed.

### L-6. Webhook verify module is very thin

- **File:** `src/webhook/verify.ts:1-18`
- **Description:** A single function wrapping Bun's `Bun.CryptoHasher` for HMAC-SHA256 verification. Well-implemented and secure.
- **Suggested fix:** None needed. Noted as positive -- clean separation of concerns.

### L-7. Multiple in-memory caches could be unified

- **Files:** `src/webhook/dedup.ts`, `src/slack/thread-session-store.ts`, `src/slack/write-confirmation-store.ts`, `src/index.ts:178`
- **Description:** At least 4 different in-memory caching implementations exist, each with slightly different TTL/eviction behavior (or none at all).
- **Suggested fix:** Consider a shared `InMemoryCache<K, V>` utility with configurable TTL, max size, and optional LRU eviction.

### L-8. Scope coordinator is trivially simple

- **File:** `src/lib/scope-coordinator.ts:1-31`
- **Description:** The scope coordinator is a 31-line module that checks if multiple package managers are present. It's well-implemented but could be a utility function rather than a standalone module.
- **Suggested fix:** Fine as-is for consistency with other lib modules.

### L-9. Timeout estimator uses linear risk bands

- **File:** `src/lib/timeout-estimator.ts:40-60`
- **Description:** Timeout risk is classified into linear bands ("low", "moderate", "high", "critical") based on file count and total lines. The thresholds are reasonable but could benefit from being configurable.
- **Suggested fix:** Low priority. Current thresholds are sensible defaults.

### L-10. Dead code: `listFeedbackSuppressions` delegates to `aggregateFeedbackPatterns`

- **File:** `src/knowledge/store.ts:1135-1137`
- **Description:** `listFeedbackSuppressions(repo)` simply calls `store.aggregateFeedbackPatterns(repo)` with no additional logic. It's a redundant alias.
- **Suggested fix:** Remove the alias or document why both exist (e.g., for API clarity).

---

## Positive Observations

### P-1. Consistent fail-open resilience pattern
The codebase consistently uses fail-open patterns for non-critical features (learning memory, feedback suppression, embedding generation, search enrichment). Core review pipeline failures are properly propagated while enrichment features degrade gracefully. This is a mature reliability pattern.

### P-2. Idempotency throughout the review pipeline
Review execution uses composite output keys, durable run state with supersession, and marker-based comment deduplication. The `review-idempotency.ts` module ensures reviews are not duplicated even under webhook replay conditions. This is production-grade.

### P-3. Structured telemetry with proper retention
The telemetry system uses separate tables for executions, resilience events, retrieval quality, and rate-limit events. Retention purging runs at startup. WAL mode with periodic checkpointing ensures durability without blocking reads. Well-designed.

### P-4. Security-conscious input sanitization
The sanitizer module (`src/lib/sanitizer.ts`) handles HTML comment stripping, invisible character removal, image alt text injection, hidden attribute attacks, and GitHub token redaction. The outgoing mention sanitizer prevents the bot from accidentally @-mentioning users. Thorough.

### P-5. Clean dependency injection via factory functions
Every module uses the factory function pattern (`createXxx({ deps })`) rather than classes or global singletons. This makes testing straightforward and dependencies explicit. The wiring in `index.ts` is clear and linear.

### P-6. Well-designed enforcement pipeline
The enforcement system (`src/enforcement/`) separates concerns cleanly: tooling detection, tooling suppression, and severity floors are independent modules composed by the orchestrator. Adding new enforcement rules is straightforward.

### P-7. Checkpoint-based timeout resilience
The review pipeline can save progress checkpoints, publish partial review comments on timeout, and enqueue reduced-scope retries. This is sophisticated and handles the real-world problem of LLM execution timeouts gracefully.

### P-8. Fork-safe workspace strategy
The workspace manager clones the base repo and fetches the PR head ref, which correctly handles PRs from forked repositories. Write-mode includes branch validation and secret scanning before creating commits. Well-thought-out.

---

## Recommendations

Ordered by impact/effort ratio (highest value first):

### 1. Fix the hardcoded `xbmc/xbmc` default repository (Critical, Low effort)
Remove `DEFAULT_REPO = "xbmc/xbmc"` from `src/slack/repo-context.ts`. This is the highest-risk finding with the simplest fix -- just require explicit repo context or resolve from installations.

### 2. Fix the `rateLimitFailureInjectionIdentities` Array/Set type mismatch (Critical, Low effort)
In `src/index.ts`, wrap with `new Set(...)` before passing to the telemetry store factory. One-line fix that prevents a runtime TypeError.

### 3. Add TTL and size caps to all in-memory stores (High, Medium effort)
Create a shared `InMemoryCache<K, V>` utility and migrate: thread session store, write confirmation store, webhook deduplicator, Slack installation cache, TOCTOU filter. This eliminates 5 separate memory leak vectors.

### 4. Add rate limiting to Slack event processing (High, Low effort)
Add a simple per-channel rate limiter in `src/routes/slack-events.ts`. This prevents unbounded LLM API spend from malicious or misbehaving integrations.

### 5. Replace `console.warn` with logger in enforcement/tooling-detection.ts (Medium, Trivial effort)
Two-line change with immediate logging infrastructure benefit.

### 6. Extract review.ts into focused modules (High, High effort)
The 3,760-line god file is the biggest maintainability risk. Extracting 5-6 focused modules would improve testability and reduce cognitive load for new contributors. This is a large refactor but high long-term value.

### 7. Fix telemetry purge to use `db.run()` instead of RETURNING (Medium, Low effort)
Prevents unnecessary memory allocation during large purge operations.

### 8. Add response timeouts to Slack API client (Medium, Low effort)
Add `AbortSignal.timeout(10_000)` to all `fetch()` calls in `src/slack/client.ts`. Prevents hung requests from blocking the event loop.

### 9. Extract repetitive config parsing into a generic helper (Medium, Medium effort)
Reduces ~300 lines of near-identical parsing code in `src/execution/config.ts` to ~30 lines plus a reusable helper.

### 10. Add context-window budget guard to review prompt construction (Medium, Medium effort)
Add a total-characters budget in `src/execution/review-prompt.ts` that gracefully truncates lower-priority sections when approaching model context limits.
