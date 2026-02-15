# Domain Pitfalls

**Domain:** Adding advanced dependency signals (usage analysis, history tracking, multi-package correlation), checkpoint publishing with timeout retry, and advanced retrieval (adaptive thresholds, recency weighting, telemetry, cross-language equivalence) to an existing AI code review bot
**Researched:** 2026-02-15
**Confidence:** HIGH (all pitfalls verified against codebase: `src/knowledge/store.ts` schema, `src/learning/memory-store.ts` vec0 tables, `src/learning/isolation.ts` threshold filtering, `src/handlers/review.ts` publish pipeline, `src/execution/executor.ts` AbortController timeout, `src/lib/dep-bump-detector.ts` existing detection; checkpoint/retry race conditions derived from existing `onPublish` callback and `reviewOutputKey` idempotency design)

---

## Critical Pitfalls

Mistakes that cause incorrect reviews, lost output, data corruption, or require architectural rework.

---

### Pitfall 1: API Usage Analysis Produces False Positives from Grep/AST Matching in Large Repos

**What goes wrong:**
Usage analysis tries to answer "does the project actually call the API that changed in this dependency bump?" by scanning the workspace for import statements and API references. The naive approach -- grep for `require('lodash')` or `import _ from 'lodash'` -- produces massive false positives in large repos. Test files, example code, documentation, commented-out code, string literals, and dead code all match. A repo like xbmc (62K+ files when submodules are counted) might show 200+ "usages" of a package that is only actually imported in 3 production files.

AST-based analysis is more accurate but exponentially slower. Parsing every `.ts`/`.js` file in a large workspace through a TypeScript AST takes 10-60 seconds depending on repo size. For the xbmc-sized repos that already hit the timeout boundary (existing `estimateTimeoutRisk` in `timeout-estimator.ts` shows high-risk scoring for repos with 100+ files), adding AST analysis could push the pre-executor pipeline time past the point where the executor itself has no budget left (see existing Pitfall 14 from v0.9 research about budget accounting).

Even AST analysis has blind spots: dynamic imports (`import()` expressions with variable paths), re-exports through barrel files, and framework-level dependency injection (Angular, NestJS) are not caught by static analysis.

**Why it happens:**
The workspace is a full git clone (created by `fetchAndCheckoutPullRequestHeadRef` in `jobs/workspace.ts`). It contains everything: source, tests, docs, configs, build output in `.gitignore` (if previously built), and potentially node_modules (if not gitignored). Grep has no concept of "production code vs test code vs dead code." AST parsing is accurate but the cost scales linearly with file count.

**Consequences:**
- False positive: "This project uses lodash.merge (12 call sites)" when 10 of those are in test fixtures. The review implies a breaking change affects production code when it does not.
- Performance: AST analysis adds 10-60 seconds to the pre-executor pipeline, consuming timeout budget. On repos already near the 600s timeout, this causes timeouts that did not occur before v0.10.
- False negative: Dynamic imports and re-exports are invisible to static analysis. The review says "this API is not used in your project" when it actually is, giving false confidence to merge.
- Resource exhaustion: On monorepos with 10K+ source files, AST analysis can consume 500MB+ of memory. Bun's process runs on Azure Container Apps with constrained memory.

**Prevention:**
- Never use full-workspace grep. Scope analysis to files that import the bumped package directly. Start with `package.json` dependencies to identify direct dependencies, then scan only import statements (regex is fine for import detection -- it is the API usage search that needs accuracy).
- Use a two-phase approach: Phase 1 (fast, always runs): regex scan for `import ... from 'package-name'` and `require('package-name')` across `.ts`/`.js`/`.tsx`/`.jsx` files, excluding `node_modules/`, `test/`, `__tests__/`, `*.test.*`, `*.spec.*`. Phase 2 (optional, budget-limited): If Phase 1 finds fewer than 20 import sites AND the bump is major version, do lightweight AST analysis on only those files to extract specific API method calls.
- Set a hard time budget for usage analysis: 3 seconds maximum. If analysis exceeds budget, return "usage analysis incomplete" rather than blocking the review. The existing `estimateTimeoutRisk` already computes a complexity score -- feed this into the usage analysis budget.
- Exclude test files by default. Optionally include them with a config flag: `review.depAnalysis.includeTestFiles: false` (default false).
- Cache import graph per workspace. If the same workspace is used for incremental re-review (same head SHA), the import scan results are reusable.

**Detection:**
- Usage analysis reports more than 50 call sites for a single package (likely includes tests/dead code).
- Pre-executor pipeline time increases by more than 5 seconds after enabling usage analysis.
- Memory usage spikes during usage analysis on large repos (monitor via Bun's process metrics).
- Users report "the bot says I use this API but I don't" (false positive from test/dead code).

**Phase to address:**
API usage analysis phase -- the two-phase approach and budget constraint must be designed before implementation. This is an architectural decision, not an implementation detail.

---

### Pitfall 2: Schema Migration Corrupts Existing SQLite Databases in Production

**What goes wrong:**
Dependency history tracking requires new tables and columns in the existing knowledge store SQLite database. The current schema (`src/knowledge/store.ts`) uses `CREATE TABLE IF NOT EXISTS` and `ensureTableColumn` (line 131-141) for additive migrations. This pattern works for adding columns but fails for structural changes: adding indexes on existing columns, changing column types, adding foreign key constraints to existing tables, or creating tables that reference existing tables with new relationships.

The production database has accumulated months of review data. A schema migration that fails mid-transaction leaves the database in a corrupt state. SQLite does not support transactional DDL for all operations -- `ALTER TABLE` cannot be rolled back in all cases. If a migration adds a new table, inserts a foreign key to `reviews`, and then fails on the next step, the partially-created table exists but may have no data or inconsistent foreign keys.

The existing `ensureTableColumn` function (line 131) uses `PRAGMA table_info()` to check for column existence, then `ALTER TABLE ADD COLUMN`. This works for nullable columns but cannot set `NOT NULL` constraints on new columns (SQLite requires a default value for `NOT NULL` on `ALTER TABLE ADD COLUMN`). If dependency history needs a `NOT NULL` column, the migration must use the SQLite backup/recreate pattern, which risks data loss if interrupted.

**Why it happens:**
The knowledge store was designed for additive schema evolution (v0.1-v0.8 only added tables and nullable columns). Dependency history introduces relational data (package history linked to reviews) that may require structural changes. The `ensureTableColumn` pattern does not handle: column removal, type changes, constraint changes, or composite index creation on existing data.

**Consequences:**
- Migration failure leaves database in inconsistent state. The knowledge store fails to initialize on next app restart.
- Data loss if migration uses recreate pattern and is interrupted (power failure, OOM kill, container restart during deploy).
- Foreign key violations if new tables reference existing data that does not conform to new constraints.
- WAL file corruption if migration runs while a concurrent webhook handler is writing to the database (the `busy_timeout` is 5000ms, but long DDL operations can exceed this).

**Prevention:**
- Design ALL new tables as additive-only. Use `CREATE TABLE IF NOT EXISTS` and `ensureTableColumn` patterns that already work. Never modify existing table schemas. If a column needs `NOT NULL`, add it with a `DEFAULT` value: `ensureTableColumn(db, "dep_history", "package_name", "package_name TEXT NOT NULL DEFAULT ''")`.
- Create a new `dep_history` table rather than adding columns to the existing `reviews` or `findings` tables. Link via `review_id` foreign key. This isolates the migration risk: if the new table fails to create, existing tables are untouched.
- Run all DDL in a single transaction wrapped in `db.transaction()`. If any step fails, the entire migration rolls back. Test the migration against a copy of the production database before deploying.
- Add a schema version tracking mechanism. The current code runs all `CREATE TABLE IF NOT EXISTS` on every startup (lines 172-302 of store.ts). Add a `schema_version` table that tracks which migrations have been applied. Only run new migrations, not all DDL on every startup. This prevents re-running expensive migrations on restart.
- Before deploying, test the migration against a dump of production data. Use `sqlite3 .dump` to create a test database and run the migration against it. Verify all existing queries still work after migration.
- Size the new tables conservatively. Dependency history for 1000 reviews with 5 dependencies each = 5000 rows. This is trivial for SQLite. But if history includes per-version advisory snapshots, the data grows multiplicatively. Set retention limits from day one.

**Detection:**
- App fails to start after deploy with SQLite error messages (table already exists with different schema, constraint violation, etc.).
- Knowledge store queries fail with "no such column" errors after a partial migration.
- Database file size grows unexpectedly (failed migration left orphaned data).
- `PRAGMA integrity_check` returns errors after migration.

**Phase to address:**
Dependency history phase -- schema design must be finalized before implementation. The additive-only constraint must be a design rule, not an afterthought.

---

### Pitfall 3: Checkpoint Publishing Creates Orphaned Partial Comments on Timeout

**What goes wrong:**
Checkpoint publishing publishes partial results (e.g., findings from the first half of files) before the full review completes, so that users get something even if the review times out. The critical failure: checkpoint publishes 3 inline comments for files A-E. The executor then times out on files F-Z. The review handler receives `isTimeout: true`. The system posts a "review timed out" error comment. Now the PR has: 3 orphaned inline comments (no summary context), plus an error comment saying the review failed.

The orphaned comments are particularly bad because they lack context. The summary comment (which was never published) would have explained the review scope, confidence levels, and finding priorities. Without it, users see random inline comments with severity tags and no framing. They do not know: are these the most important findings? Were high-risk files covered? Should they wait for a retry?

The existing `onPublish` callback (line 75 of executor.ts) tracks whether ANY publication happened (`published = true`), but not WHAT was published or HOW MANY comments exist. The `ensureReviewOutputNotPublished` idempotency check (line 1168 of review.ts) checks for the summary comment marker -- but checkpoint publishing creates inline comments, not the summary. The idempotency system sees "no summary published" and allows retry, but the inline comments already exist.

**Why it happens:**
The executor architecture is all-or-nothing by design. The `onPublish` flag is a boolean, not an inventory. MCP tool calls that post comments happen inside the LLM execution loop, interleaved with analysis. There is no "publish phase" separate from the "analysis phase" -- the LLM decides when to publish as part of its tool use. Checkpoint publishing requires intercepting this flow and staging comments rather than immediately publishing them.

**Consequences:**
- Users see inline comments without a summary comment. The PR looks like the bot malfunctioned.
- Retry after timeout creates duplicate inline comments (same finding, same line, two comments).
- Error comment says "review timed out" but published findings suggest it partially worked -- confusing UX.
- The `extractFindingsFromReviewComments` function (line 539 of review.ts) will find these orphaned comments on the next review attempt, potentially double-counting findings in dedup and delta classification.
- If the bot deletes the orphaned comments on retry (cleanup), users who already saw and acted on them lose context.

**Prevention:**
- Do NOT publish inline comments incrementally. Buffer all findings in memory. Only publish after the executor returns -- either all findings (success) or top-priority findings (timeout/partial). This preserves the existing single-publish architecture.
- If checkpoint publishing is required, use a "draft comment" pattern: accumulate findings in a staging area (in-memory array), and publish them all at once when a checkpoint threshold is reached (e.g., every 5 findings). But always publish with a checkpoint summary: "Checkpoint: reviewed 15/42 files so far. Analysis continuing..."
- Track published checkpoint comment IDs in the review handler's state. On timeout, update the checkpoint summary to: "Review completed partially. 15/42 files reviewed. Below findings are from reviewed files only." This converts orphaned checkpoints into a coherent partial review.
- On retry after timeout, always check for existing checkpoint comments. If they exist, either (a) keep them and only publish findings for the remaining files, or (b) delete them all and do a fresh reduced-scope review. Never mix checkpoint results with retry results.
- The simplest approach: publish ALL accumulated findings as a single batch when the timeout signal fires, before the error handler runs. The `AbortController` in executor.ts fires a signal -- add an `onAbort` callback that publishes buffered findings as a coherent partial review (with summary) instead of just setting `published = false`.

**Detection:**
- Inline comments exist on a PR with no corresponding summary comment (orphaned checkpoints).
- More than one summary comment on a PR for the same head SHA (checkpoint summary + retry summary).
- `extractFindingsFromReviewComments` returns findings from multiple review output keys on the same PR.
- Error comment posted on a PR that also has inline findings.

**Phase to address:**
Checkpoint publishing phase -- the buffering-vs-incremental decision is the most consequential architecture choice. Strongly recommend the buffer-and-flush approach because it preserves the existing single-publish-point architecture that v0.1-v0.9 infrastructure depends on.

---

### Pitfall 4: Timeout Retry Creates Infinite Retry Loops and Resource Exhaustion

**What goes wrong:**
The retry logic: on timeout, reduce scope (fewer files) and retry. But scope reduction does not guarantee the retry will complete within the timeout. The LLM may spend all its time on the reduced file set -- fewer files does not mean less analysis time if the remaining files are complex. The retry times out again. The system reduces scope further and retries. Each retry costs LLM tokens, API quota, and queue slot time. Without a retry cap, the system enters an infinite loop: timeout -> reduce -> timeout -> reduce -> timeout...

On Azure Container Apps, each retry holds the job queue slot (existing `PQueue({ concurrency: 1 })` per installation). While retrying, all other PRs for that installation are queued. A single large-repo timeout loop can block all reviews for an organization for 30+ minutes (3 retries x 600s timeout each).

**Why it happens:**
Scope reduction is a heuristic, not a guarantee. The timeout is a wall-clock budget for LLM execution, and the LLM's behavior is non-deterministic. Reviewing 10 high-complexity files may take longer than reviewing 30 simple files. The existing `estimateTimeoutRisk` provides complexity scoring but it estimates the INITIAL timeout, not whether a reduced-scope retry will succeed.

**Consequences:**
- Resource exhaustion: Each retry costs $0.10-$2.00 in LLM tokens (depending on prompt size). 3 retries on a large PR = $3-$6 wasted on reviews that never complete.
- Queue starvation: The installation's job queue is blocked for the duration of all retries. Other PRs wait.
- Duplicate comments: If each retry attempt publishes partial results before timing out (interaction with Pitfall 3), the PR accumulates multiple sets of orphaned comments.
- Token waste: Each retry regenerates the full prompt (diff, context, retrieval results), consuming Voyage AI embedding credits and Anthropic tokens.
- Exponential backoff trap: If retry spacing uses exponential backoff (common pattern), the total elapsed time grows rapidly: 600s + 1200s + 2400s = 4200s (70 minutes) for 3 retries.

**Prevention:**
- Hard cap: maximum 1 retry after timeout. If the retry also times out, post an error comment and stop. Do not use exponential backoff for timeout retries -- the second attempt should use the same timeout with reduced scope, not a longer timeout.
- No-retry for repos that consistently timeout. Track timeout history in the knowledge store. If a repo has timed out on 3 of its last 5 reviews, disable retry for that repo and suggest config changes: "This repository consistently exceeds the review timeout. Consider adding `.kodiai.yml` with `review.timeoutSeconds: 1200` or reducing scope with `review.excludeGlobs`."
- Budget cap: set a total token budget per review (including retries). If the first attempt uses 80% of the budget, do not retry -- post partial results from the first attempt instead.
- Enqueue retry as a new job with lower priority. Do not retry in the same job execution. This allows other pending reviews to process between the original attempt and the retry. The existing `checkAndClaimRun` transaction (line 511 of store.ts) already handles job deduplication -- extend it with a `retryCount` field to enforce the retry cap.
- The retry should use a SMALLER timeout than the original, not the same timeout. If the original was 600s and timed out, the retry with reduced scope should use 300s (half). If it cannot complete in half the time with fewer files, more retries will not help.

**Detection:**
- More than 1 retry for a single review (retry cap exceeded).
- Total elapsed time for a review exceeds 2x the configured timeout (indicates retries).
- Token cost for a single PR review exceeds the p99 for the installation (indicates retry waste).
- Queue depth exceeds 5 for an installation (indicates queue starvation from retries).

**Phase to address:**
Timeout retry phase -- the retry cap and budget constraints must be designed before implementation. The "maximum 1 retry" rule and "smaller timeout for retry" rule are non-negotiable guard rails.

---

### Pitfall 5: Adaptive Distance Thresholds Become Unstable with Small Sample Sizes

**What goes wrong:**
Knee-point detection algorithms (L-method, elbow method, Kneedle) estimate the optimal distance threshold by finding the "knee" in the sorted distance curve of retrieval results. With small sample sizes (fewer than 10 retrieval candidates), the knee-point estimate is statistically meaningless. The curve has too few points to identify a meaningful inflection. The algorithm either picks a random point as the "knee" (threshold oscillates between reviews) or defaults to the first/last point (threshold is always too tight or too loose).

The current memory store (`learning_memories` table) starts empty for new repos and grows slowly -- one finding per review, maybe 2-5 findings per review at best. After 20 reviews, a repo might have 50-100 stored findings. The retrieval query returns the top-K nearest neighbors (typically K=5 or K=10). With 50 stored findings, the distance distribution is sparse and noisy. Knee-point detection on 5-10 distances is numerically unstable.

**Why it happens:**
Knee-point algorithms are designed for smooth, monotonically increasing curves with sufficient samples (typically 50+). Embedding distance distributions with small datasets are noisy: the gap between the 3rd and 4th nearest neighbor may be larger than the gap between the 1st and 2nd, purely due to sparse coverage. The algorithm interprets this noise as signal (a "knee") and sets the threshold at the noisy gap.

**Consequences:**
- Threshold oscillation: similar PRs on the same repo get different thresholds because the knee-point shifts with each new stored finding. Review A returns 5 retrieval results; Review B (similar PR, one day later, one more finding in the store) returns 2 results. Users see inconsistent behavior.
- Cold-start degeneration: new repos with fewer than 10 memories always get degenerate knee-point estimates. The threshold is either so loose it returns everything (including irrelevant results) or so tight it returns nothing.
- Numerical edge cases: if all K candidates have the same distance (happens when embeddings cluster), the knee-point algorithm divides by zero or returns the first point. If K=1, there is no curve to analyze.

**Prevention:**
- Require a minimum sample size for knee-point detection. If the retrieval returns fewer than 8 candidates (below the minimum), fall back to the fixed default threshold (currently configurable via `knowledge.retrieval.distanceThreshold`). This is the single most important guard rail.
- Use a simple percentile-based fallback for small samples: take the median distance of the K results as the threshold. This is more stable than knee-point for small K but less sophisticated than knee-point for large K. Switch to knee-point only when K >= 15.
- Add a floor and ceiling to the adaptive threshold: never go below 0.15 (too tight, returns nothing) or above 0.65 (too loose, returns noise). The current fixed threshold is in the 0.3-0.5 range based on config defaults. The adaptive mechanism should stay within this band.
- Log the effective threshold, candidate count, and detection method (fixed/percentile/knee-point) in the retrieval provenance (existing `RetrievalWithProvenance` type in `learning/types.ts`). This enables post-hoc analysis of threshold stability.
- Unit test the knee-point algorithm with edge cases: K=1, K=2, all-same-distance, monotonically decreasing distance (all close), monotonically increasing with a gap, and the typical noisy distribution. These edge cases WILL occur in production.

**Detection:**
- Threshold variance across consecutive reviews on the same repo exceeds 0.15 (oscillation).
- Retrieval returns 0 results on a repo with 50+ non-stale memories (threshold too tight).
- Retrieval returns K results all at the distance ceiling (threshold too loose, no filtering occurred).
- Knee-point algorithm produces NaN or Infinity (numerical edge case).

**Phase to address:**
Adaptive threshold phase -- the minimum sample size guard and fallback strategy must be implemented before any knee-point algorithm. Test the fallback first, add knee-point as an upgrade path.

---

## Moderate Pitfalls

Mistakes that cause significant rework or degraded user experience but are recoverable.

---

### Pitfall 6: Multi-Package Correlation Over-Groups Unrelated Packages

**What goes wrong:**
Multi-package correlation detects that packages bumped together in the same PR (or across related PRs) are likely related, enabling grouped analysis: "These 4 packages are all from the React ecosystem." But the correlation logic over-groups: `react`, `eslint-plugin-react`, `@types/react`, and `react-router` are all "react-related" by name, but a breaking change in `react-router` has nothing to do with `react` core. Grouping them suggests they should be evaluated together when they are independent.

Worse: Renovate's group update feature bundles packages into a single PR based on Renovate config (e.g., "group all eslint packages"). These groupings reflect the repo maintainer's CI preference, not semantic dependency relationships. `eslint`, `eslint-plugin-import`, and `eslint-config-prettier` are grouped in a Renovate PR because they are all "eslint stuff," but a major bump in `eslint-config-prettier` has no technical relationship to an `eslint` patch bump.

**Why it happens:**
Package name similarity is a weak proxy for technical dependency. Namespace prefixes (`@babel/*`, `@testing-library/*`) group packages by organization, not by coupling. Renovate/Dependabot groupings are CI configuration artifacts, not dependency analysis.

**Consequences:**
- Misleading analysis: "This React ecosystem update includes a breaking change" when the breaking change is only in `react-router` and does not affect `react` core usage.
- Wasted LLM tokens: grouped analysis sends all package changelogs/advisories as a single context block, increasing prompt size with irrelevant information.
- False correlation: "Package A and Package B are always bumped together" (because Renovate groups them), treated as evidence that they are technically coupled, when they are not.

**Prevention:**
- Use package dependency relationships (from the lock file resolved tree), not name similarity or PR co-occurrence, to establish correlation. Package A correlates with Package B only if A depends on B (or vice versa) in the resolved dependency tree.
- If lock file analysis is too complex for v0.10, use a simpler heuristic: group only packages with the exact same npm scope (`@babel/core` + `@babel/parser`) and only when they appear in the same Renovate group PR. Do NOT group across scopes.
- Always present correlation as informational, not definitive: "These packages share the `@babel` scope and were bumped together" rather than "These packages are related."
- Allow package-level analysis to override group-level analysis. If `@babel/parser` has a breaking change but `@babel/core` does not, the individual analysis should be prominent, not hidden inside a group summary.
- Never correlate based solely on historical co-occurrence. Two packages bumped in the same PR 5 times is not evidence of coupling -- it is evidence of Renovate grouping config.

**Detection:**
- Group contains more than 5 packages (likely over-grouped).
- Group contains packages from different npm scopes (name-based grouping, not dependency-based).
- Breaking change reported at the group level when only one package in the group has a breaking change.

**Phase to address:**
Multi-package correlation phase -- the correlation heuristic (dependency tree vs name similarity) must be decided before implementation. Dependency tree is correct but complex; scope-based grouping is simple and good enough for v0.10.

---

### Pitfall 7: Recency Weighting Makes the System Forget Valuable Old Patterns

**What goes wrong:**
Recency weighting boosts recent retrieval results over older ones, on the theory that recent findings are more relevant to the current code state. But aggressive decay discards the system's most valuable memories: rare, high-severity findings that occurred months ago. A critical security finding from 6 months ago (e.g., "SQL injection in query builder") is far more valuable than a minor style finding from yesterday, but recency weighting ranks them inversely.

The failure mode is particularly dangerous because it is invisible: the system silently stops surfacing old high-severity findings. No one notices until a similar vulnerability reappears and the system does not reference the prior finding.

**Why it happens:**
Recency weighting applies a time-decay multiplier to distance scores. A finding from 6 months ago has its effective distance inflated by the decay factor, pushing it below the threshold even if its semantic distance is excellent. The weighting treats all findings equally -- it does not distinguish between "this is old and irrelevant" and "this is old and critically important."

**Consequences:**
- Security findings from past reviews are forgotten. The system fails to warn "you had a similar SQL injection issue 6 months ago" because the recency weight pushed it out of retrieval results.
- The system's effective memory window shrinks to the decay half-life. With aggressive decay (half-life of 30 days), findings older than 90 days are effectively invisible.
- The learning system loses its primary value proposition: long-term pattern recognition across reviews.

**Prevention:**
- Use severity-aware decay: critical and major findings decay at a much slower rate (or not at all) compared to minor and style findings. Security findings should have zero decay -- they are always relevant.
- Implement a minimum decay floor: no finding's recency weight should be lower than 0.3 (30% of its original weight), regardless of age. This ensures old findings can still surface if their semantic match is strong enough.
- Weight recency as a SECONDARY signal, not primary. The retrieval pipeline should: (1) retrieve by semantic distance (primary), (2) apply recency as a tie-breaker when two results have similar distance (within 0.05). Do NOT multiply distance by recency -- add a small recency bonus to the distance score.
- Formula recommendation: `effectiveDistance = semanticDistance + recencyPenalty * 0.1` where `recencyPenalty` ranges from 0 (today) to 0.5 (6+ months old). This caps the recency impact at a 0.05 distance penalty, which is minor compared to the typical distance range of 0.1-0.6.
- Provide a "highlight old patterns" mechanism: if a finding from more than 3 months ago is within the distance threshold WITHOUT recency weighting, include it with a tag: "Historical pattern: similar issue found 4 months ago." This makes the long-term memory visible even with recency weighting.

**Detection:**
- Retrieval never returns findings older than the decay half-life (all results are recent).
- A critical finding from 3+ months ago is semantically relevant (low distance) but not returned (recency weight excluded it).
- System repeatedly surfaces the same low-severity recent findings while ignoring high-severity historical ones.

**Phase to address:**
Recency weighting phase -- the severity-aware decay and minimum floor must be designed before any decay formula is implemented. Test with historical data: take the current memory store contents and verify that enabling recency weighting does not exclude any critical/major findings that are currently returned.

---

### Pitfall 8: Retrieval Telemetry Causes Observer Effect and Metric Spam

**What goes wrong:**
Retrieval telemetry logs every retrieval query, its results, distance scores, threshold used, and relevance assessment. This telemetry serves two purposes: debugging retrieval quality and tuning the distance threshold. But the telemetry itself changes system behavior:

1. **Observer effect:** Telemetry writes to the SQLite database (the existing `telemetry/store.ts` pattern). Each retrieval now includes a database write. If the telemetry store uses the same database as the knowledge store (which uses WAL mode with `busy_timeout = 5000`), the telemetry write can block knowledge store reads. On high-traffic installations (10+ concurrent PRs), telemetry writes create WAL contention that slows down retrieval -- making the retrieval slower than it would be without telemetry.

2. **Metric spam:** Every review generates 1-3 retrieval queries (repo-scoped, owner-scoped, retry). Each query produces 5-20 telemetry rows (one per candidate result plus metadata). For an installation processing 50 reviews/day, that is 250-3000 telemetry rows per day. The telemetry store grows faster than the knowledge store, and without aggressive retention, it consumes more disk than the actual review data.

3. **Logging overhead:** If retrieval telemetry uses the existing pino logger at `debug` level (like the current provenance logging at line 110 of isolation.ts), it generates 100+ log lines per review. On Azure Container Apps with log shipping, this increases logging costs and makes relevant logs harder to find.

**Why it happens:**
Telemetry is typically designed with the assumption that writes are cheap and storage is unlimited. In a SQLite-backed system running on container instances with limited disk, writes contend with production reads and storage is finite. The existing telemetry store (telemetry/store.ts) does periodic WAL checkpoints (every 1000 writes, line 103), but retrieval telemetry could push write frequency much higher.

**Consequences:**
- Retrieval latency increases by 5-20ms per query due to telemetry write contention. For reviews with 3 retrieval queries, that is 15-60ms of added latency on the critical path.
- Disk usage grows 3-5x faster than expected. Telemetry data dominates the database.
- Debug logs become 80% retrieval telemetry noise, making it harder to diagnose actual issues.
- In worst case, WAL file grows unbounded if telemetry writes outpace checkpoints, eventually causing out-of-disk on the container.

**Prevention:**
- Use a separate SQLite database for retrieval telemetry. The existing pattern already separates the knowledge store and telemetry store into different database files. Create a dedicated retrieval telemetry database with its own retention policy (7-day retention, vs 30-day for knowledge store).
- Sample telemetry: log detailed telemetry for 10% of retrieval queries, not all. Use a deterministic sampling key (e.g., `reviewId % 10 === 0`) so that all retrieval queries for a given review are either all logged or all skipped. This prevents partial telemetry for a single review.
- Batch telemetry writes: accumulate telemetry records in memory during the review, then write them all in a single transaction after the review completes. This avoids interleaving telemetry writes with production retrieval reads.
- Use structured logging (pino) at `info` level for aggregate metrics ("retrieval: 5 results, threshold 0.40, latency 45ms") and `debug` level for per-result details. Do not log per-result details at `info` level.
- Set a hard retention limit: auto-purge retrieval telemetry older than 7 days. The existing `purgeOlderThan` pattern in `telemetry/store.ts` provides the template.

**Detection:**
- Retrieval latency increases after enabling telemetry (A/B comparison with telemetry on/off).
- Telemetry database file size exceeds knowledge store database file size.
- WAL file for telemetry database exceeds 10MB (indicates checkpoint backlog).
- Debug log volume increases by more than 50% after enabling retrieval telemetry.

**Phase to address:**
Retrieval telemetry phase -- the sampling strategy and separate database must be designed before implementation. Telemetry that degrades the system it measures is counter-productive.

---

### Pitfall 9: Cross-Language Equivalence Produces False Equivalences

**What goes wrong:**
Cross-language equivalence maps packages across ecosystems (e.g., `lodash` (npm) == `lodash.py` (PyPI) == `lo-dash` (NuGet)), enabling the system to surface relevant findings from a Python review when reviewing a TypeScript PR that uses the equivalent package. But the mapping is inherently imprecise:

- `requests` (Python) and `axios` (npm) are "equivalent" in the sense that both are HTTP clients, but their APIs, failure modes, and security characteristics are completely different. A finding about `requests` session handling is not relevant to `axios` interceptors.
- `moment` (npm) and `datetime` (Python stdlib) serve similar purposes but are not equivalent -- one is a library with known deprecation issues, the other is a language standard library.
- Package names are not globally unique across ecosystems. `colors` means different things on npm vs PyPI vs RubyGems.

**Why it happens:**
There is no authoritative cross-ecosystem package equivalence database. Any mapping table is manually curated and reflects subjective judgments about "equivalence." The granularity of equivalence varies: some packages are exact ports (same API), some are spiritual successors (similar purpose, different API), and some are same-name-different-thing.

**Consequences:**
- False equivalence: The system retrieves a Python `requests` finding when reviewing TypeScript `axios` code. The finding is not applicable, but the LLM treats it as relevant context, potentially producing a misleading review comment.
- Maintenance burden: The equivalence mapping table must be manually maintained. Every new package addition requires human judgment. The table becomes stale as packages are deprecated, renamed, or superseded.
- Scope creep: once equivalence mapping exists, there is pressure to expand it to more packages, more ecosystems, and finer-grained mappings (function-level equivalence). Each expansion increases the false positive surface.
- Inconsistency: the mapping is many-to-many. `requests` (Python) maps to both `axios` and `node-fetch` in npm. Which one is "equivalent" depends on the use case, not the package name.

**Prevention:**
- Start with an extremely small, high-confidence mapping table: only packages that are EXACT ports across ecosystems (e.g., `lodash` npm <-> `pydash` PyPI, `protobuf` npm <-> `protobuf` PyPI). Require that the packages share the same upstream project or explicitly claim equivalence.
- Maximum 20 mappings in v0.10. Each mapping must have a documented justification and a confidence level.
- Use equivalence only as a retrieval BOOST (reduce distance by 10%), not as a direct match. A cross-language equivalent result should still compete on semantic distance with same-language results. It should never override a same-language result with better semantic match.
- Add a user-visible attribution: "Similar pattern found in Python equivalent (`pydash`)" so users understand why a cross-language finding appeared and can judge relevance themselves.
- Do NOT attempt to auto-generate equivalence mappings from package metadata (descriptions, keywords). This produces massive false positive rates. Manual curation only.
- Make the mapping table configurable per repo: `review.retrieval.equivalences: { "axios": ["requests", "http-client"] }`. This allows repos to define their own equivalences and override/disable system defaults.

**Detection:**
- Users report "irrelevant cross-language findings" in review context.
- Retrieved cross-language findings have consistently higher distance than same-language findings (indicates weak equivalence).
- Mapping table has not been updated in 3+ months (stale mappings).

**Phase to address:**
Cross-language equivalence phase -- the manual curation approach and 20-mapping cap must be enforced from day one. This feature has the highest false-positive risk of any v0.10 feature.

---

### Pitfall 10: Dependency History Storage Growth Overwhelms SQLite on Active Repos

**What goes wrong:**
Dependency history tracks every dependency bump across all reviews: package name, old version, new version, advisory snapshot, changelog excerpt, and analysis result. For active repos with weekly Dependabot/Renovate runs, this grows linearly. A repo with 50 dependencies, weekly bumps, and 50 weeks of history accumulates 2500 history rows. With advisory snapshots (JSON blobs) and changelog excerpts (text blobs), each row could be 2-10KB. Total: 5-25MB of dependency history data per active repo.

For a Kodiai installation serving 50 repos, that is 250MB-1.25GB of dependency history data in the knowledge store database. The current knowledge store manages reviews + findings + feedback + suppression logs -- dependency history could exceed all other data combined.

SQLite handles this data volume fine from a correctness standpoint, but performance degrades for aggregate queries: "what is the bump history for package X across all versions?" requires scanning all history rows. Without proper indexing and retention, these queries become slow (100ms+) and compete with the hot path (review recording, finding extraction).

**Why it happens:**
Dependency history is append-only by nature. Unlike reviews (which have natural boundaries per PR), dependency history accumulates indefinitely. Advisory snapshots are particularly large because they include full advisory text, affected version ranges, and severity scores.

**Prevention:**
- Set aggressive retention from day one: 90-day retention for full history records, 365-day retention for summary records (package name + version + bump type only, no advisory/changelog blobs). Implement retention in the `purgeOldRuns` cycle (existing pattern at line 838 of store.ts).
- Store advisory and changelog data as separate rows (or in a separate table) referenced by foreign key, not inline in the history row. This allows pruning large blobs while keeping the lightweight history record.
- Index the history table on `(repo, package_name, created_at)` for efficient per-package queries and `(created_at)` for efficient retention purge.
- Set a per-repo row cap: maximum 5000 history rows per repo. When the cap is exceeded, purge oldest records. This prevents any single active repo from dominating the database.
- Use SQLite's `VACUUM` after large purge operations to reclaim disk space. The existing code does not vacuum -- add periodic vacuum to the maintenance cycle.
- Consider storing advisory/changelog blobs compressed (gzip). SQLite stores BLOBs efficiently, but text fields are uncompressed. A 5KB JSON advisory compresses to ~1KB.

**Detection:**
- Knowledge store database file exceeds 100MB (current baseline is likely 5-20MB).
- Dependency history query latency exceeds 50ms.
- `dep_history` table row count exceeds 10000 per repo.
- WAL file grows larger than 10MB during history write operations.

**Phase to address:**
Dependency history phase -- retention policy and storage caps must be implemented alongside the schema, not as a follow-up.

---

## Minor Pitfalls

Mistakes that cause friction but are quickly fixable.

---

### Pitfall 11: Checkpoint Publishing Race Condition with GitHub API Rate Limits

**What goes wrong:**
Checkpoint publishing makes multiple GitHub API calls in rapid succession (one per inline comment). GitHub's REST API has a secondary rate limit that throttles requests sent too quickly in succession (typically 20+ requests within a few seconds). If a checkpoint publishes 8 findings as 8 individual `createReviewComment` API calls within 1 second, the secondary rate limit kicks in and some calls fail with HTTP 403. The successful comments are published; the failed ones are lost. The checkpoint is partially published with no indication of which findings were lost.

**Prevention:**
- Batch inline comments into a single pull request review submission (`createReview` with multiple comments) rather than individual `createReviewComment` calls. The existing MCP comment server likely already uses `createReview` -- verify this and ensure checkpoint publishing follows the same pattern.
- If individual comment calls are used, add a 100ms delay between calls. This keeps the rate well below GitHub's secondary limit.
- Track which comments succeeded and which failed. On failure, retry the failed comments with backoff, or log them for inclusion in the summary comment as text rather than inline comments.

**Detection:**
- HTTP 403 errors from GitHub API during comment publishing.
- Published finding count is less than intended finding count after checkpoint.
- Intermittent "secondary rate limit" error messages in logs.

**Phase to address:**
Checkpoint publishing phase -- API call batching is an implementation detail but must be considered in the design.

---

### Pitfall 12: Recency Weighting Breaks Deterministic Retrieval Testing

**What goes wrong:**
Current retrieval tests (e.g., `memory-store.test.ts`, `retrieval-rerank.test.ts`) use fixed embeddings and verify distance-based ordering. Adding recency weighting introduces time-dependency: test results change depending on when the test data was created. A test that passes at midnight fails at noon because the recency weights shifted.

**Prevention:**
- Make recency weighting accept an injectable "current time" parameter for testing. Never use `Date.now()` or `datetime('now')` directly in the weighting function. Use a `now` parameter with a default of the current time in production.
- Create test fixtures with explicit timestamps and test against those timestamps by passing the corresponding `now` value. Tests should be time-independent.
- Add a "disable recency weighting" flag for tests and for repos that prefer pure semantic retrieval.

**Detection:**
- Flaky retrieval tests that fail intermittently (time-dependent ordering).
- Test ordering changes when test data ages past a decay threshold.

**Phase to address:**
Recency weighting phase -- injectable time is a standard testing pattern. Apply it from the first implementation.

---

### Pitfall 13: Cross-Language Equivalence Table Becomes a Maintenance Black Hole

**What goes wrong:**
The equivalence table starts with 20 well-researched mappings. Over time, users request additions ("add X equivalent to Y"). Each request requires research into whether the packages are truly equivalent. Without a clear process, mappings accumulate without review. Eventually the table contains 200+ mappings of varying quality, some added years ago for packages that have been deprecated or renamed.

**Prevention:**
- Store the equivalence table as a versioned JSON file in the repo (e.g., `src/data/cross-language-equivalences.json`), not hardcoded in source. Each entry includes: `confidence` (high/medium), `justification` (one line), `addedDate`, `lastVerified`.
- Set a calendar reminder: review the equivalence table quarterly. Remove mappings for deprecated packages, lower confidence on mappings with user-reported false positives.
- Gate community contributions: mappings can only be added through PR review, not config. Each new mapping requires a test case showing a realistic retrieval scenario where the equivalence adds value.
- Maximum 50 mappings total. If the table needs more than 50 entries, the approach is wrong -- consider a different architecture (e.g., embedding-space proximity rather than explicit mapping).

**Detection:**
- Table has not been reviewed in 6+ months.
- More than 20% of mappings have `confidence: medium` (indicates uncertain equivalences).
- Users report false equivalences more than once per month.

**Phase to address:**
Cross-language equivalence phase -- the maintenance process must be defined alongside the initial table.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| API usage analysis | False positives from test/dead code (P1) | CRITICAL | Two-phase approach with file exclusions, 3s time budget |
| Dependency history | Schema migration corruption (P2) | CRITICAL | Additive-only schema, new tables not column changes, test against prod data |
| Dependency history | Storage growth (P10) | MODERATE | 90-day retention, per-repo row cap, separate blob storage |
| Multi-package correlation | Over-grouping unrelated packages (P6) | MODERATE | Use dependency tree not name similarity, scope-based grouping only |
| Checkpoint publishing | Orphaned partial comments (P3) | CRITICAL | Buffer-and-flush on timeout, never publish incrementally |
| Checkpoint publishing | GitHub API rate limits (P11) | MINOR | Batch into single createReview call, 100ms delay between individual calls |
| Timeout retry | Infinite retry loops (P4) | CRITICAL | Max 1 retry, smaller timeout on retry, no retry for chronic-timeout repos |
| Adaptive thresholds | Instability with small samples (P5) | CRITICAL | Minimum 8 candidates for knee-point, percentile fallback, floor/ceiling |
| Recency weighting | Forgetting valuable old patterns (P7) | MODERATE | Severity-aware decay, minimum 0.3 floor, recency as tie-breaker not primary |
| Recency weighting | Breaks deterministic testing (P12) | MINOR | Injectable time parameter, explicit test timestamps |
| Retrieval telemetry | Observer effect and metric spam (P8) | MODERATE | Separate database, 10% sampling, batch writes, 7-day retention |
| Cross-language equivalence | False equivalences (P9) | MODERATE | Manual curation only, 20-mapping cap, boost not override, user attribution |
| Cross-language equivalence | Maintenance burden (P13) | MINOR | Versioned JSON, quarterly review, max 50 mappings |

## Integration Pitfalls: Feature Interactions Within v0.10

| Interaction | What Goes Wrong | Prevention |
|-------------|----------------|------------|
| Usage analysis + timeout retry | Usage analysis adds 10-60s to pre-executor pipeline. First attempt times out. Retry also runs usage analysis, wasting 10-60s of the reduced timeout budget on analysis that already completed. | Cache usage analysis results keyed by (repo, headSha). On retry, reuse cached results. Skip usage analysis entirely if the retry timeout budget is under 300s. |
| Checkpoint publishing + retrieval telemetry | Each checkpoint triggers a telemetry write (retrieval results for the checkpoint batch). Multiple checkpoints per review multiply the telemetry volume. A review with 3 checkpoints generates 3x the normal telemetry. | Telemetry should log once per review, not per checkpoint. Aggregate checkpoint retrieval data in memory and write a single telemetry record at review completion. |
| Adaptive thresholds + recency weighting | Both modify the effective distance score. Adaptive threshold sets the cutoff; recency weighting adjusts individual distances. If both are aggressive, the combined effect excludes too many results. A finding at distance 0.35 (within default threshold 0.45) gets a recency penalty of 0.08 (old finding), pushing effective distance to 0.43. Adaptive threshold then tightens to 0.40 (based on knee-point of recent results), and the old finding is excluded. | Apply recency weighting BEFORE adaptive threshold computation. The adaptive threshold should be computed on recency-adjusted distances, not raw distances. This ensures the threshold accounts for the weighting. |
| Cross-language equivalence + adaptive thresholds | Cross-language results have naturally higher distances (different embedding spaces). Adaptive threshold tightens based on same-language results (which cluster at lower distances). The tightened threshold excludes all cross-language results. | Compute adaptive threshold separately for same-language and cross-language result pools. Or: apply equivalence boost before threshold computation, same as recency weighting. |
| Multi-package correlation + checkpoint publishing | Correlation analysis groups packages for combined analysis. If the grouped analysis is published as a checkpoint but the individual package analyses are not yet complete, the checkpoint shows a group summary without per-package details. Later, individual analyses complete but the group summary is already published. | Complete all package analyses before computing correlation groupings. Correlation is a post-processing step, not a streaming step. Do not publish correlation results as checkpoints. |
| Dependency history + schema migration + telemetry | History writes and telemetry writes happen concurrently. Both use the same SQLite WAL journal. Heavy history writes during a Dependabot batch (10 PRs at once) create WAL contention that slows telemetry writes, which delays checkpoint completion. | Use separate database files for dependency history (in knowledge store DB) and retrieval telemetry (in telemetry DB). They already use separate `Database` instances -- verify they also use separate files. |

## Pitfall-to-Phase Mapping

| Pitfall | ID | Severity | Prevention Phase | Verification Criteria |
|---------|----|----------|------------------|-----------------------|
| Usage analysis false positives | P1 | CRITICAL | API usage analysis | File exclusion list implemented. Test file matches < 10% of results. Time budget enforced (< 3s). Memory usage < 200MB during analysis. |
| Schema migration corruption | P2 | CRITICAL | Dependency history | All new DDL is additive-only. Migration tested against prod data dump. Schema version table exists. `PRAGMA integrity_check` passes post-migration. |
| Orphaned checkpoint comments | P3 | CRITICAL | Checkpoint publishing | No inline comments without summary context. Buffer-and-flush architecture verified. Idempotency check covers checkpoint markers. |
| Infinite retry loops | P4 | CRITICAL | Timeout retry | Max 1 retry enforced. Retry timeout < original timeout. No retry for repos with 3+ recent timeouts. Total elapsed time < 2x configured timeout. |
| Adaptive threshold instability | P5 | CRITICAL | Adaptive thresholds | Minimum 8 candidates for knee-point. Fallback to percentile for small samples. Threshold floor 0.15, ceiling 0.65. Edge cases unit tested (K=1, K=2, all-same-distance). |
| Multi-package over-grouping | P6 | MODERATE | Multi-package correlation | Groups based on dependency tree or exact npm scope, not name similarity. No groups larger than 5 packages. Individual analysis visible alongside group summary. |
| Recency forgets old patterns | P7 | MODERATE | Recency weighting | Severity-aware decay implemented. Critical/major findings have 0.3 minimum floor. Recency impact capped at 0.05 distance penalty. Old critical findings still surface in testing. |
| Telemetry observer effect | P8 | MODERATE | Retrieval telemetry | Separate database file. 10% sampling rate. Batch writes. 7-day retention. Retrieval latency increase < 5ms with telemetry enabled. |
| Cross-language false equivalence | P9 | MODERATE | Cross-language equivalence | Manual curation only. Max 20 initial mappings. Each mapping has justification. Equivalence used as boost (10%), not override. User-visible attribution on cross-language results. |
| Dependency history storage growth | P10 | MODERATE | Dependency history | 90-day full retention, 365-day summary retention. Per-repo 5000 row cap. Database size increase < 50% after enabling history. Purge runs on existing maintenance cycle. |
| Checkpoint API rate limits | P11 | MINOR | Checkpoint publishing | Comments batched into single createReview call. No HTTP 403 errors in checkpoint path. |
| Recency breaks test determinism | P12 | MINOR | Recency weighting | Injectable time parameter in weighting function. No `Date.now()` in production code path. All tests time-independent. |
| Equivalence maintenance burden | P13 | MINOR | Cross-language equivalence | Versioned JSON file with metadata. Max 50 mappings. Quarterly review process documented. |

## Prioritized Risk Register

| Priority | Pitfall | Impact | Probability | Rationale |
|----------|---------|--------|-------------|-----------|
| P0 | Orphaned checkpoint comments (P3) | High | Very High | Any checkpoint implementation that publishes incrementally WILL leave orphaned comments on timeout. The existing executor architecture has no staged-publish capability. |
| P0 | Infinite retry loops (P4) | Very High | High | Without explicit retry caps, the first large-repo timeout triggers unlimited retries. Each retry costs real money (LLM tokens) and blocks the queue. |
| P0 | Adaptive threshold instability (P5) | High | Very High | Most repos have < 100 memories. Knee-point on < 8 samples is mathematically meaningless. Every new repo installation will hit this. |
| P1 | Usage analysis false positives (P1) | High | High | Large repos (100+ files) with test suites will always produce false positives without file exclusion. Performance impact on timeout-prone repos is additive. |
| P1 | Schema migration corruption (P2) | Very High | Medium | Only triggers if migration design is non-additive. Medium probability because the existing codebase uses additive patterns -- but the temptation to modify existing tables is strong. |
| P1 | Recency forgets old patterns (P7) | High | High | Any exponential decay function will exclude old findings within a few half-lives. The default must be conservative or the learning system's value is destroyed. |
| P2 | Multi-package over-grouping (P6) | Medium | High | Name-based grouping is the obvious-but-wrong first implementation. High probability because it is the simplest approach. |
| P2 | Cross-language false equivalence (P9) | Medium | Medium | Only manifests when cross-language retrieval fires. Medium probability because polyglot repos are uncommon, but when it hits, the irrelevant findings damage trust. |
| P2 | Telemetry observer effect (P8) | Medium | Medium | Only manifests under high traffic (10+ concurrent reviews). Medium probability but insidious because the performance degradation is gradual and hard to attribute. |
| P2 | Dependency history storage growth (P10) | Medium | High | Every active repo with Dependabot/Renovate will accumulate history. Without retention, growth is guaranteed. |
| P3 | Checkpoint API rate limits (P11) | Low | Medium | Only triggers when publishing 8+ comments in rapid succession. Easily prevented with batching. |
| P3 | Recency breaks test determinism (P12) | Low | High | Will definitely cause flaky tests if not addressed, but fix is trivial (injectable time). |
| P3 | Equivalence maintenance burden (P13) | Low | Medium | Only becomes a problem over time (6+ months). Low immediate risk. |

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Usage analysis false positives (P1) | LOW | (1) Add file exclusion list. (2) Add time budget. Pure code changes, no data migration. |
| Schema migration corruption (P2) | HIGH | (1) Restore from backup. (2) Redesign migration as additive-only. (3) Re-deploy. If no backup exists, data loss is permanent. Prevention is essential. |
| Orphaned checkpoint comments (P3) | MEDIUM | (1) Build cleanup script to delete orphaned comments via GitHub API. (2) Switch to buffer-and-flush architecture. (3) Run cleanup on affected PRs. |
| Infinite retry loops (P4) | LOW | (1) Add retry cap (code change). (2) Kill any in-progress retry loops. (3) Deploy immediately. |
| Adaptive threshold instability (P5) | LOW | (1) Add minimum sample size check. (2) Add floor/ceiling. Pure code changes. |
| Multi-package over-grouping (P6) | LOW | (1) Switch from name-based to scope-based grouping. (2) No data migration needed. |
| Recency forgets old patterns (P7) | LOW | (1) Adjust decay parameters. (2) Add severity-aware floor. No data changes -- retrieval is computed at query time. |
| Telemetry observer effect (P8) | MEDIUM | (1) Migrate to separate database file. (2) Add sampling. (3) Purge existing over-sized telemetry data. May require brief downtime for database file reorganization. |
| Cross-language false equivalence (P9) | LOW | (1) Reduce mapping table to high-confidence entries only. (2) Lower equivalence boost factor. Configuration change. |
| Dependency history storage growth (P10) | MEDIUM | (1) Add retention purge. (2) Run initial purge (may take minutes for large databases). (3) Add VACUUM to maintenance cycle. |

## Sources

### Primary (HIGH confidence)
- Kodiai codebase analysis: `src/knowledge/store.ts` (SQLite schema, `ensureTableColumn` migration pattern, `purgeOldRuns` retention, `busy_timeout` WAL settings), `src/execution/executor.ts` (AbortController timeout, `onPublish` callback, MCP tool dispatch), `src/handlers/review.ts` (review pipeline, `extractFindingsFromReviewComments`, `ensureReviewOutputNotPublished` idempotency), `src/learning/memory-store.ts` (vec0 virtual table, `retrieveMemories`, `writeMemory` transaction), `src/learning/isolation.ts` (`distanceThreshold` filtering, `RetrievalWithProvenance`), `src/learning/retrieval-rerank.ts` (distance adjustment multipliers), `src/lib/timeout-estimator.ts` (complexity scoring, dynamic timeout), `src/lib/dep-bump-detector.ts` (existing detection pipeline, ecosystem mapping), `src/telemetry/store.ts` (WAL checkpoint pattern, insert frequency)

### Secondary (MEDIUM confidence)
- SQLite documentation on ALTER TABLE limitations and transactional DDL behavior
- GitHub REST API secondary rate limit documentation (20+ rapid requests trigger throttling)
- Knee-point detection literature: L-method and Kneedle algorithm require minimum sample sizes for statistical validity (typically 15-50 data points)
- Embedding retrieval best practices: recency weighting as secondary signal, severity-aware decay patterns from production recommendation systems

### Tertiary (LOW confidence)
- Cross-language package equivalence: no authoritative source exists. The claim that manual curation is the only viable approach is based on the absence of any reliable automated cross-ecosystem mapping system in training data (verified: no such system was found in web searches).
- sqlite-vec performance characteristics at 10K+ records: documented as exact KNN (not ANN), but real-world performance with WAL contention under concurrent writes needs empirical validation in Kodiai's specific deployment environment.

---
*Pitfalls research for: Kodiai v0.10 -- Advanced Signals (Usage Analysis, Dependency History, Multi-Package Correlation, Checkpoint Publishing, Timeout Retry, Adaptive Thresholds, Recency Weighting, Retrieval Telemetry, Cross-Language Equivalence)*
*Researched: 2026-02-15*
*Supersedes: 2026-02-14 v0.9 pitfalls research (different feature scope)*
