# Phase 56: Foundation Layer - Research

**Researched:** 2026-02-15
**Domain:** SQLite-backed telemetry + knowledge store extensions; review prompt intent UX
**Confidence:** HIGH

## User Constraints

- **Goal:** Add foundational data infrastructure + low-risk enrichments for v0.10 advanced signals.
- **Success criteria:**
  - Record dependency bump merge history (pkg name, version bump, semver class, merge confidence, advisory status).
  - Log retrieval quality metrics (result count, avg distance, threshold used, language match ratio) to the telemetry DB after retrieval reviews.
  - Surface unrecognized bracket tags as focus hints in the review prompt (not as "ignored").
  - Schema migrations must be additive-only.
- **Global v0.10 constraints (from `.planning/STATE.md`):**
  - Timeout retry capped at 1 max to avoid queue starvation.
  - Adaptive thresholds need minimum 8-candidate guard.
  - Recency weighting needs severity-aware decay floor (0.3 minimum).
  - Checkpoint publishing must use buffer-and-flush on abort, not streaming.
  - Schema migrations must be additive-only (new tables, nullable columns).
- **Explicit user policies (from `.planning/STATE.md`):**
  - No auto re-review on push.
  - No unsolicited responses.

## Summary

Phase 56 is best planned as three small, additive extensions that align with existing repo patterns:

1) Extend the **knowledge store** (SQLite) with a new dependency bump history table and a small write API. Populate it from a lightweight handler triggered on `pull_request.closed` when the PR is merged. Reuse the existing dependency bump detection, semver classification, advisory lookup, and merge confidence scoring already implemented for review-time enrichment.

2) Extend the **telemetry store** (SQLite) with a new retrieval-quality table and a small write API. Populate it in the review handler after retrieval context generation (the LEARN-07 block), using `rerankByLanguage()` outputs to compute language match ratio and average adjusted distance.

3) Update the **intent parsing UX** so unrecognized bracket tags become first-class “focus hints” in the review prompt (and in the deterministic Review Details block) instead of being rendered as “ignored”. This is primarily a prompt/formatting change plus one new parameter passed into `buildReviewPrompt()`.

**Primary recommendation:** Implement new additive tables + insert APIs in `src/knowledge/store.ts` and `src/telemetry/store.ts`, then wire them into event handlers without changing existing execution behavior.

## Standard Stack

### Core
| Library/Tech | Version | Purpose | Why Standard (in this repo) |
|---|---:|---|---|
| Bun (`bun:sqlite`) | (runtime) | Embedded SQLite for telemetry/knowledge | Used in `src/telemetry/store.ts` and `src/knowledge/store.ts` |
| SQLite WAL mode | n/a | Concurrency + durability tradeoff | Enabled in both stores via `PRAGMA journal_mode = WAL` |
| TypeScript (ESM) | peer `^5` | Implementation language | Repo uses TS ESM throughout (`"type": "module"`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---|---:|---|---|
| `pino` | `^10.3.0` | Logging | Store init + fail-open logging |
| `@octokit/rest` | `^22.0.1` | GitHub API access | Advisory/changelog enrichment already uses it |
| `sqlite-vec` | `^0.1.7-alpha.2` | Vector retrieval in knowledge DB | Needed for LEARN-07 retrieval context |
| `picomatch` | `^4.0.2` | Glob matching | Used in prompt building and skip paths |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Hand-rolled migrations | Dedicated migration tool | Not used in this repo; current pattern is `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` guards |

## Architecture Patterns

### Recommended Project Structure (as-is)
Key extension points for Phase 56:

```
src/
├── knowledge/          # knowledge store schema + writes
├── telemetry/          # telemetry store schema + writes
├── handlers/           # webhook event handlers
├── lib/                # dep bump + intent parsing utilities
└── execution/          # review prompt builder
```

### Pattern 1: SQLite Store Factories Own Schema Creation
**What:** Store factories create/extend schema on startup using `CREATE TABLE IF NOT EXISTS` and guarded `ALTER TABLE ... ADD COLUMN`.
**When to use:** Any time a new table/nullable column is introduced.
**Why:** No separate migration runner exists; schema is bootstrapped in code.

**Example (knowledge additive migration helper):**
```ts
// Source: src/knowledge/store.ts
function ensureTableColumn(db: Database, tableName: string, columnName: string, columnDefinition: string): void {
  if (hasTableColumn(db, tableName, columnName)) return;
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
}
```

### Pattern 2: Handler DI + Fail-Open Enrichments
**What:** `src/index.ts` wires store instances into handlers; handlers attempt enrichments but proceed on failure.
**When to use:** Advisory lookup / retrieval context / merge history writes.
**Example:** Dependency bump enrichment uses `Promise.allSettled` and leaves enrichment fields undefined/null on failure.

### Pattern 3: Prompt Building is Centralized in `buildReviewPrompt()`
**What:** All prompt-visible UX changes should go through `src/execution/review-prompt.ts`.
**When to use:** Adding a “focus hints” section from unrecognized bracket tags.
**Anti-pattern to avoid:** injecting new prompt text ad-hoc in handlers.

### Anti-Patterns to Avoid
- **Non-additive schema changes:** no DROP/RENAME of existing columns/tables; only new tables or nullable columns.
- **Coupling new telemetry to execution correctness:** logging must be fire-and-forget and non-blocking, like existing `telemetryStore.record()`.
- **Retry loops in webhook handlers:** respect the v0.10 cap (max 1 retry) by avoiding new internal retry policies.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Semver bump classification | New semver parser | `classifyDepBump()` / `parseSemver()` | Already consistent with dep bump pipeline (`src/lib/dep-bump-detector.ts`) |
| Merge confidence logic | New scoring rules | `computeMergeConfidence()` | Centralized rationale + stable semantics (`src/lib/merge-confidence.ts`) |
| Advisory extraction | Custom GitHub API parsing elsewhere | `fetchSecurityAdvisories()` | Already maps ecosystem + dedupes (`src/lib/dep-bump-enrichment.ts`) |
| Language match measurement | Ad-hoc file extension checks | `rerankByLanguage()` + `classifyFileLanguage()` | Existing logic includes Unknown neutral handling |

**Key insight:** This phase is about persistence + telemetry, not inventing new scoring logic; reuse existing “pure function” classifiers to keep risk low.

## Common Pitfalls

### Pitfall 1: “Additive-only” violated accidentally
**What goes wrong:** A planner adds a non-null column without a default, or attempts a table rewrite/rename.
**Why it happens:** SQLite `ALTER TABLE ADD COLUMN` has constraints; non-null requires a non-null default.
**How to avoid:** Prefer new tables. If adding columns, make them nullable and guard with `PRAGMA table_info` checks (like `ensureTableColumn`).
**Warning signs:** Startup errors on `ALTER TABLE`, tests failing only on existing DB files.

### Pitfall 2: Retrieval metrics computed from the wrong distance
**What goes wrong:** Using raw `distance` rather than `adjustedDistance` yields misleading averages after language rerank.
**Why it happens:** `rerankByLanguage()` applies multipliers, but handler currently discards `languageMatch`.
**How to avoid:** Compute metrics from the reranked array (include `languageMatch` count + `adjustedDistance` mean).
**Warning signs:** Language match ratio always 0, or avg distance doesn’t reflect rerank behavior.

### Pitfall 3: Merge history handler accidentally posts comments
**What goes wrong:** A `pull_request.closed` registration reuses the review pipeline and triggers LLM execution or PR comments.
**Why it happens:** Existing review handler is job-based and publishes output.
**How to avoid:** Implement a dedicated “record only” handler that writes to SQLite and returns; no executor invocation.
**Warning signs:** Bot leaves comments on merge events; violates “No unsolicited responses”.

### Pitfall 4: WAL checkpoint starvation / giant WAL files
**What goes wrong:** New write-heavy tables cause WAL files to grow and slow reads.
**Why it happens:** WAL requires periodic checkpoints; long-lived connections + no checkpointing can grow WAL.
**How to avoid:** Keep the existing checkpoint strategy: telemetry auto-checkpoints every 1000 writes; knowledge store checkpoints at startup and can be called.
**Warning signs:** Disk usage growth (`*.db-wal`), slower queries.

## Code Examples

Verified patterns from this repo (preferred to follow exactly):

### Add a New Additive Table in a Store Factory
```ts
// Source: src/telemetry/store.ts (pattern)
db.run(`
  CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ...
  )
`);
```

### Guarded Add-Column Migration (Knowledge Store)
```ts
// Source: src/knowledge/store.ts
ensureTableColumn(db, "findings", "comment_id", "comment_id INTEGER");
```

### Compute Retrieval Quality Metrics from Reranked Results
```ts
// Source: src/learning/retrieval-rerank.ts
const reranked = rerankByLanguage({ results: retrieval.results, prLanguages });
const resultCount = reranked.length;
const avgAdjustedDistance = resultCount === 0
  ? null
  : reranked.reduce((sum, r) => sum + r.adjustedDistance, 0) / resultCount;
const languageMatchRatio = resultCount === 0
  ? null
  : reranked.filter(r => r.languageMatch).length / resultCount;
```

### Surface Focus Hints in Prompt (Planned Interface)
```ts
// Source: src/handlers/review.ts (planned wiring)
buildReviewPrompt({
  ...,
  focusHints: parsedIntent.unrecognized,
});
```

## State of the Art

| Old Approach | Current Approach (in this repo) | When Changed | Impact |
|---|---|---|---|
| Separate migration tooling | Schema bootstrapped in store factories | pre-v0.10 | Faster iteration; requires careful additive-only discipline |
| “Ignored” unknown bracket tags | Treat unknown tags as focus hints | Phase 56 | Better intent UX; fewer confusing “ignored” signals |

**Deprecated/outdated:**
- Treating unrecognized bracket tags as noise: replaced by “focus hints” (INTENT-01).

## Open Questions

1. **Where exactly should dependency bump merge history be recorded?**
   - What we know: Review handler registers only `opened`, `ready_for_review`, `review_requested`, `synchronize` (`src/handlers/review.ts`).
   - What's unclear: Whether the system currently listens to `pull_request.closed` events at all.
   - Recommendation: Add a dedicated handler (or extend router registration) for `pull_request.closed` that only records merge history when `pull_request.merged === true`.

2. **How should retrieval quality rows correlate to executions?**
   - What we know: Telemetry executions are written with `deliveryId`, `repo`, `prNumber`, `eventType` (`src/telemetry/store.ts`, `src/handlers/review.ts`).
   - What's unclear: Whether `deliveryId` is always present/stable for joining.
   - Recommendation: Use `(delivery_id, repo, pr_number)` as the join key and add a UNIQUE constraint on `delivery_id` in the new retrieval quality table (or store both `delivery_id` + `session_id`).

## Sources

### Primary (HIGH confidence)
- `src/knowledge/store.ts` - additive schema approach (`CREATE TABLE IF NOT EXISTS`, `ensureTableColumn`)
- `src/telemetry/store.ts` - telemetry DB factory + prepared inserts + WAL checkpointing
- `src/handlers/review.ts` - dep bump enrichment, retrieval context generation, telemetry write point
- `src/lib/dep-bump-detector.ts` - package/version/ecosystem extraction + semver class
- `src/lib/dep-bump-enrichment.ts` - advisory lookup + changelog fetching
- `src/lib/merge-confidence.ts` - merge confidence scoring
- `src/lib/pr-intent-parser.ts` - recognized vs unrecognized bracket tag parsing
- `src/learning/retrieval-rerank.ts` - language match + adjusted distance

### Secondary (MEDIUM confidence)
- https://www.sqlite.org/lang_altertable.html - `ALTER TABLE ... ADD COLUMN` constraints and additive characteristics (page updated 2025-11-13)
- https://www.sqlite.org/wal.html - WAL checkpointing and concurrency behavior (page updated 2025-05-31)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions and usage confirmed in `package.json` and store implementations
- Architecture: HIGH - patterns confirmed in handler wiring and store factories
- Pitfalls: MEDIUM - based on SQLite docs + existing repo conventions

**Research date:** 2026-02-15
**Valid until:** 2026-03-17
