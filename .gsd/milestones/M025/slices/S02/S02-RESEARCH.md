# Phase 121: Page Popularity - Research

**Researched:** 2026-03-03
**Domain:** MediaWiki API integration, PostgreSQL scoring/aggregation, retrieval pipeline instrumentation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Separate `wiki_page_popularity` table with `page_id` FK -- not columns on `wiki_pages` (which is chunked, many rows per page)
- One row per page_id, updated in-place on each refresh
- Store all individual signals AND composite score: `inbound_links` (int), `citation_count` (int), `edit_recency_score` (float), `composite_score` (float)
- Include metadata columns: `last_scored_at`, `last_linkshere_fetch`, `last_citation_reset` -- granular freshness tracking per signal source
- Instrument the retrieval pipeline in `retrieval.ts` -- after cross-corpus RRF, increment citation count for wiki pages that appeared in results
- Only count pages that survive the adaptive threshold (meaningful citations, not noise)
- Lightweight event log table: `(page_id, cited_at)` per retrieval hit -- enables rolling window aggregation
- Rolling 90-day window for citation counts (aligns with Phase 122's 90-day PR scan window)
- Weighted normalized sum: normalize each signal to 0-1 range, then `w1*links + w2*citations + w3*recency`
- Default weights: citations heaviest -- links=0.3, citations=0.5, recency=0.2
- Weights defined as config constants in a dedicated module (not env vars) -- easy to tune, importable by Phase 122+
- Edit recency uses exponential decay from `last_modified`: `score = e^(-lambda * days_since_edit)`
- All pages scored regardless of zero signals
- Scheduled job using wiki-staleness-detector's scheduler pattern -- runs independently of retrieval
- Weekly interval (matching staleness detector cycle)
- Full refresh of linkshere API data each run (wiki isn't huge, simpler than incremental)
- Separate one-time backfill script for initial population (same pattern as `wiki-backfill.ts`)

### Claude's Discretion
- Exact normalization approach (min-max vs percentile rank)
- Lambda value for exponential decay
- API rate limiting / batching strategy for linkshere calls
- Migration file numbering and exact column types
- Backfill script CLI interface

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| POP-01 | MediaWiki inbound link counts fetched via `linkshere` API for all wiki pages | MediaWiki linkshere prop module documented; existing `wiki-sync.ts` fetch patterns reusable; full-refresh strategy viable for kodi.wiki scale |
| POP-02 | Retrieval citation frequency tracked -- counts how often each wiki page appears in retrieval results | `retrieval.ts` instrumentation point identified after cross-corpus RRF + source weight + language boost; wiki chunks identifiable by `source === "wiki"` with `metadata.pageId`; event log table pattern documented |
| POP-03 | Edit recency captured as a popularity signal (more recently edited = more active) | `wiki_pages.last_modified` column already exists with TIMESTAMPTZ; exponential decay formula documented with recommended lambda |
| POP-04 | Composite popularity score combining inbound links, citation frequency, and edit recency | Weighted normalized sum formula with normalization approach recommended; scoring module pattern documented |
</phase_requirements>

## Summary

Phase 121 builds a composite page popularity scoring system for kodi.wiki pages. The system has three data sources (MediaWiki linkshere API for inbound links, retrieval pipeline instrumentation for citation frequency, and existing `wiki_pages.last_modified` for edit recency), a scoring formula (weighted normalized sum with exponential decay for recency), and a scheduled refresh job.

The codebase already has strong patterns to follow: the `wiki-staleness-detector.ts` provides the scheduler pattern (startup delay, interval, run state, fail-open), `wiki-sync.ts` provides the MediaWiki API fetching pattern (fetch + parse + rate-limit delays), and `wiki-backfill.ts` provides the one-time population script pattern. The `retrieval.ts` pipeline has a clear instrumentation point after cross-corpus RRF where wiki chunks can be identified by `source === "wiki"` and their `metadata.pageId` extracted.

The main technical considerations are: (1) the linkshere API is a prop module that must be called per-page via `titles` or `pageids` parameter, so batching up to 50 pages per request is critical for performance; (2) citation tracking must be non-blocking and fail-open to avoid degrading retrieval latency; (3) the normalization approach for the composite score needs to handle sparse signals gracefully (pages with zero for one signal should still score on others).

**Primary recommendation:** Follow existing codebase patterns closely. Use min-max normalization with floor protection for the composite score, instrument retrieval with async fire-and-forget citation logging, and batch linkshere API calls using the `pageids` parameter (up to 50 per request).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (postgres.js) | existing | All DB operations via tagged templates | Already used project-wide via `Sql` type from `db/client.ts` |
| pino | existing | Structured logging | Already used project-wide |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | existing | CLI argument validation for backfill script | Already in project, used in `config.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct fetch for linkshere API | mwn (MediaWiki Node.js client) | Adds dependency for simple GET requests; existing fetch pattern in `wiki-sync.ts` is sufficient |
| PostgreSQL for citation events | Redis/in-memory counter | Adds infrastructure; PostgreSQL append-only table with rolling window deletion is simpler and durable |

**Installation:**
```bash
# No new dependencies required -- all libraries already in project
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── knowledge/
│   ├── wiki-popularity-store.ts      # CRUD for wiki_page_popularity + wiki_citation_events tables
│   ├── wiki-popularity-scorer.ts     # Composite scoring logic + scheduler
│   ├── wiki-popularity-config.ts     # Weight constants, lambda, config for Phase 122+ import
│   ├── wiki-linkshere-fetcher.ts     # MediaWiki linkshere API client
│   └── wiki-popularity-backfill.ts   # One-time initial population script
├── db/
│   └── migrations/
│       ├── 020-wiki-page-popularity.sql       # New table
│       ├── 020-wiki-page-popularity.down.sql
│       ├── 021-wiki-citation-events.sql       # Citation event log
│       └── 021-wiki-citation-events.down.sql
```

### Pattern 1: Scheduler (from wiki-staleness-detector.ts)
**What:** Factory function returning `{ start(), stop(), runNow() }` with interval, startup delay, run-state persistence, and `running` guard.
**When to use:** The popularity scorer scheduled job.
**Example:**
```typescript
// Source: src/knowledge/wiki-staleness-detector.ts (lines 395-597)
export function createWikiPopularityScorer(
  opts: WikiPopularityScorerOptions,
): WikiPopularityScheduler {
  const logger = opts.logger.child({ module: "wiki-popularity-scorer" });
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let startupHandle: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function runScoring(): Promise<WikiPopularityScoringResult> {
    // 1. Fetch linkshere counts for all pages
    // 2. Aggregate citation events (90-day window)
    // 3. Compute edit recency scores
    // 4. Normalize and combine
    // 5. Upsert wiki_page_popularity rows
  }

  async function doScore(): Promise<WikiPopularityScoringResult> {
    if (running) { /* skip */ }
    running = true;
    try { return await runScoring(); }
    finally { running = false; }
  }

  return {
    start() { /* setTimeout then setInterval pattern */ },
    stop() { /* clearTimeout + clearInterval */ },
    runNow: doScore,
  };
}
```

### Pattern 2: MediaWiki API Fetching (from wiki-sync.ts)
**What:** Fetch with rate-limiting delays, pagination via continue tokens, fail-open error handling.
**When to use:** The linkshere API client.
**Example:**
```typescript
// Source: src/knowledge/wiki-sync.ts (lines 119-248)
// Adapting for linkshere: use prop=linkshere on batched pageids
async function fetchLinkshere(
  baseUrl: string,
  pageIds: number[],
  fetchFn: typeof globalThis.fetch,
  logger: Logger,
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  // Batch pageids (up to 50 per request per MediaWiki API limits)
  for (let i = 0; i < pageIds.length; i += 50) {
    const batch = pageIds.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query",
      prop: "linkshere",
      pageids: batch.join("|"),
      lhprop: "pageid",
      lhlimit: "500",
      lhnamespace: "0",  // Main namespace only
      format: "json",
    });
    // Paginate within batch using lhcontinue
    let hasMore = true;
    while (hasMore) {
      const response = await fetchFn(`${baseUrl}/w/api.php?${params}`);
      // ... process response, accumulate counts per page_id
      // ... handle continuation
      hasMore = /* check response.continue */;
    }
    await sleep(500); // Rate limiting between batches
  }
  return counts;
}
```

### Pattern 3: Fire-and-Forget Citation Logging
**What:** Non-blocking INSERT into citation event log after retrieval completes.
**When to use:** Instrumentation in `retrieval.ts` after unified results are computed.
**Example:**
```typescript
// In retrieval.ts, after unifiedResults is finalized (after line ~808)
// Extract wiki page_ids from results that survived threshold
const wikiPageIds = unifiedResults
  .filter((c) => c.source === "wiki")
  .map((c) => c.metadata?.pageId as number)
  .filter((id): id is number => typeof id === "number" && id > 0);

if (wikiPageIds.length > 0 && deps.citationLogger) {
  // Fire-and-forget: never block retrieval on citation logging
  deps.citationLogger.logCitations(wikiPageIds).catch((err) => {
    logger.warn({ err }, "Citation logging failed (fail-open)");
  });
}
```

### Pattern 4: Backfill Script (from wiki-backfill.ts)
**What:** CLI-runnable script with progress logging, sync-state awareness, and resume capability.
**When to use:** Initial population of wiki_page_popularity table.
**Example:**
```bash
bun run src/knowledge/wiki-popularity-backfill.ts
```

### Anti-Patterns to Avoid
- **Blocking retrieval on citation logging:** Citation INSERT must be fire-and-forget. The retrieval pipeline is latency-sensitive -- any DB write in the hot path would degrade response time.
- **Storing composite score on wiki_pages table:** wiki_pages has many rows per page (one per chunk). Popularity is page-level, not chunk-level.
- **Fetching linkshere one page at a time:** The MediaWiki API supports batching up to 50 `pageids` per request. Single-page fetching would be N requests instead of N/50.
- **Using SUM without time window for citations:** Raw cumulative counts would inflate scores for old popular pages. The 90-day rolling window ensures citation counts reflect current relevance.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MediaWiki API pagination | Custom pagination state machine | Adapt existing loop pattern from `wiki-sync.ts` / `wiki-backfill.ts` | Already battle-tested with error handling and rate limiting |
| Scheduled job infrastructure | Custom cron/scheduling | Adapt `wiki-staleness-detector.ts` scheduler pattern | Handles startup delay, interval, running guard, run-state persistence |
| Exponential decay calculation | Complex date arithmetic | `Math.exp(-lambda * daysSinceEdit)` | Standard formula, single line |
| Min-max normalization | Custom statistics library | Simple SQL `MIN()`/`MAX()` in scoring query | PostgreSQL handles this natively with window functions |

**Key insight:** Every pattern needed already exists in the codebase. The risk is not missing libraries but diverging from established patterns. Follow `wiki-staleness-detector.ts` for the scheduler, `wiki-sync.ts` for API fetching, and `wiki-backfill.ts` for the one-time script.

## Common Pitfalls

### Pitfall 1: Division by Zero in Min-Max Normalization
**What goes wrong:** If all pages have the same value for a signal (e.g., all have 0 inbound links), min === max and the normalization formula divides by zero.
**Why it happens:** Sparse data early on, or after a fresh backfill with no citation events yet.
**How to avoid:** Guard with `if (max === min) return 0.0` (or 0.5 if you want neutral). All-zero signals should normalize to 0, not NaN.
**Warning signs:** NaN or null composite scores in the database.

### Pitfall 2: Linkshere API Returns Pages Across All Namespaces
**What goes wrong:** Without `lhnamespace=0`, counts include Talk pages, User pages, Template transclusions, etc., inflating counts with non-meaningful links.
**Why it happens:** MediaWiki defaults to all namespaces.
**How to avoid:** Always pass `lhnamespace=0` (Main namespace) to count only content page links.
**Warning signs:** Pages with suspiciously high link counts (>100) that seem unremarkable.

### Pitfall 3: Citation Event Table Grows Unbounded
**What goes wrong:** The `wiki_citation_events` table accumulates rows indefinitely as retrieval runs.
**Why it happens:** No cleanup mechanism for events older than the 90-day window.
**How to avoid:** The scoring refresh job should DELETE events older than 90 days after aggregation. Add an index on `cited_at` for efficient range-based cleanup.
**Warning signs:** Table row count growing linearly with retrieval traffic.

### Pitfall 4: Retrieval Latency Degradation from Synchronous Citation Logging
**What goes wrong:** Adding a synchronous INSERT to the retrieval hot path adds 5-20ms per retrieval call.
**Why it happens:** Natural tendency to await the INSERT result.
**How to avoid:** Use fire-and-forget pattern: `logCitations(...).catch(err => logger.warn(...))` without await. Citation loss is acceptable; retrieval latency is not.
**Warning signs:** Retrieval p99 latency increasing after citation tracking is deployed.

### Pitfall 5: Linkshere Pagination Truncation
**What goes wrong:** A page with >500 inbound links (the API limit per request) gets an incomplete count because pagination continuation is not followed.
**Why it happens:** The prop module `linkshere` uses continuation via `lhcontinue` -- easy to miss in the first implementation.
**How to avoid:** Always check `response.continue` and loop with `lhcontinue` parameter until complete. Cap at a reasonable maximum (e.g., 5000) to prevent runaway pagination for extremely popular pages.
**Warning signs:** Popular pages (Main_Page, FAQ) showing suspiciously low link counts.

## Code Examples

Verified patterns from project source code:

### Migration: wiki_page_popularity Table
```sql
-- Migration 020: Wiki page popularity scores
-- Stores composite popularity score per wiki page combining inbound links,
-- citation frequency, and edit recency.

CREATE TABLE wiki_page_popularity (
  id              SERIAL PRIMARY KEY,
  page_id         INTEGER NOT NULL UNIQUE,
  page_title      TEXT NOT NULL,

  -- Individual signals
  inbound_links   INTEGER NOT NULL DEFAULT 0,
  citation_count  INTEGER NOT NULL DEFAULT 0,
  edit_recency_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,

  -- Composite
  composite_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,

  -- Freshness tracking per signal source
  last_scored_at        TIMESTAMPTZ,
  last_linkshere_fetch  TIMESTAMPTZ,
  last_citation_reset   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by composite score for top-N queries
CREATE INDEX idx_wiki_page_popularity_score
  ON wiki_page_popularity (composite_score DESC);

-- FK-style lookup by page_id (not enforced FK since wiki_pages has multiple rows per page_id)
CREATE INDEX idx_wiki_page_popularity_page_id
  ON wiki_page_popularity (page_id);
```

### Migration: wiki_citation_events Table
```sql
-- Migration 021: Wiki citation event log
-- Lightweight append-only log of when wiki pages appear in retrieval results.
-- Used for rolling-window citation frequency aggregation.

CREATE TABLE wiki_citation_events (
  id        BIGSERIAL PRIMARY KEY,
  page_id   INTEGER NOT NULL,
  cited_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for rolling window aggregation (count citations in last 90 days)
CREATE INDEX idx_wiki_citation_events_page_cited
  ON wiki_citation_events (page_id, cited_at);

-- Index for cleanup of old events
CREATE INDEX idx_wiki_citation_events_cited_at
  ON wiki_citation_events (cited_at);
```

### Popularity Config Module
```typescript
// Source: new file src/knowledge/wiki-popularity-config.ts

/** Composite score weights -- must sum to 1.0 */
export const POPULARITY_WEIGHTS = {
  inboundLinks: 0.3,
  citationFrequency: 0.5,
  editRecency: 0.2,
} as const;

/** Exponential decay lambda for edit recency.
 *  lambda = ln(2) / halfLifeDays
 *  With halfLife=90 days: a page edited 90 days ago scores 0.5,
 *  180 days ago scores 0.25, etc.
 */
export const RECENCY_HALF_LIFE_DAYS = 90;
export const RECENCY_LAMBDA = Math.LN2 / RECENCY_HALF_LIFE_DAYS; // ~0.0077

/** Rolling window for citation count aggregation */
export const CITATION_WINDOW_DAYS = 90;

/** Linkshere API settings */
export const LINKSHERE_BATCH_SIZE = 50;     // Max pageids per API request
export const LINKSHERE_RATE_LIMIT_MS = 500; // Delay between API batches
export const LINKSHERE_MAX_PER_PAGE = 5000; // Cap pagination for extremely popular pages
export const LINKSHERE_NAMESPACE = 0;       // Main namespace only
```

### Composite Score Computation
```typescript
/**
 * Compute composite popularity score using min-max normalized weighted sum.
 * All signals normalized to [0, 1] then combined with configured weights.
 */
export function computeCompositeScore(params: {
  inboundLinks: number;
  citationCount: number;
  daysSinceEdit: number;
  normalization: {
    maxInboundLinks: number;
    minInboundLinks: number;
    maxCitationCount: number;
    minCitationCount: number;
  };
}): { editRecencyScore: number; compositeScore: number } {
  const { inboundLinks, citationCount, daysSinceEdit, normalization } = params;

  // Normalize inbound links (min-max with zero-division guard)
  const linkRange = normalization.maxInboundLinks - normalization.minInboundLinks;
  const normalizedLinks = linkRange > 0
    ? (inboundLinks - normalization.minInboundLinks) / linkRange
    : 0;

  // Normalize citation count (min-max with zero-division guard)
  const citRange = normalization.maxCitationCount - normalization.minCitationCount;
  const normalizedCitations = citRange > 0
    ? (citationCount - normalization.minCitationCount) / citRange
    : 0;

  // Edit recency via exponential decay
  const editRecencyScore = Math.exp(-RECENCY_LAMBDA * daysSinceEdit);

  // Weighted sum
  const compositeScore =
    POPULARITY_WEIGHTS.inboundLinks * normalizedLinks +
    POPULARITY_WEIGHTS.citationFrequency * normalizedCitations +
    POPULARITY_WEIGHTS.editRecency * editRecencyScore;

  return { editRecencyScore, compositeScore };
}
```

### Retrieval Pipeline Citation Instrumentation
```typescript
// In retrieval.ts, after line ~808 (after cross-corpus dedup, before return)
// Location: inside the retrieve() function, just before assembling provenance

const wikiPageIds = unifiedResults
  .filter((c) => c.source === "wiki")
  .map((c) => c.metadata?.pageId as number)
  .filter((id): id is number => typeof id === "number" && id > 0);

if (wikiPageIds.length > 0 && deps.wikiCitationLogger) {
  // Fire-and-forget -- never block retrieval pipeline
  void deps.wikiCitationLogger.logCitations(wikiPageIds).catch((err) => {
    logger.warn({ err, count: wikiPageIds.length }, "Wiki citation logging failed (fail-open)");
  });
}
```

### Top-N Query Pattern
```typescript
// Used by Phase 122+ to get the most popular pages
async function getTopPages(sql: Sql, limit: number): Promise<PopularityRecord[]> {
  const rows = await sql`
    SELECT * FROM wiki_page_popularity
    ORDER BY composite_score DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToRecord);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PageView stats via PageViewInfo extension | Inbound links + citation frequency + edit recency | N/A (kodi.wiki lacks PageViewInfo) | Must use proxy signals instead of direct page view data |
| Single popularity metric (e.g., view count) | Multi-signal composite score | Project design decision | More robust -- works even without analytics data |

**Deprecated/outdated:**
- MediaWiki `prop=info&inprop=visitingwatchers` was considered but requires special permissions and only shows watchers, not visitors.
- kodi.wiki does NOT have the PageViewInfo extension installed (confirmed in project out-of-scope decisions).

## Open Questions

1. **Exact normalization thresholds for edge cases**
   - What we know: Min-max normalization works well for normally distributed data. Zero-division guard needed.
   - What's unclear: Whether citation counts will be highly skewed (a few pages with many citations, most with zero) in early operation.
   - Recommendation: Use min-max normalization with floor protection. If skew becomes problematic after initial deployment, switch to percentile rank (log-transform or rank-based). This is a config constant change, not a structural change. **Recommending min-max for simplicity.**

2. **Lambda value for exponential decay**
   - What we know: Lambda controls how quickly recency decays. Higher lambda = faster decay.
   - What's unclear: Optimal value depends on kodi.wiki edit frequency patterns.
   - Recommendation: Use half-life of 90 days (lambda = ln(2)/90 = ~0.0077). This means a page edited 90 days ago gets 50% recency score, 180 days gets 25%. Aligns with the 90-day citation window. **Recommending lambda = ln(2)/90.**

3. **Migration numbering**
   - What we know: Current highest migration is 019-triage-comment-reactions.sql.
   - What's unclear: Whether other phases may have claimed 020 before this runs.
   - Recommendation: Use 020 for wiki_page_popularity and 021 for wiki_citation_events. If collision occurs, renumber.

## Sources

### Primary (HIGH confidence)
- `src/knowledge/wiki-staleness-detector.ts` -- Scheduler pattern, run-state persistence, factory function
- `src/knowledge/wiki-sync.ts` -- MediaWiki API fetch pattern, rate limiting, pagination
- `src/knowledge/wiki-backfill.ts` -- One-time backfill script pattern, resume via sync state
- `src/knowledge/retrieval.ts` -- Full retrieval pipeline, cross-corpus RRF, source identification
- `src/knowledge/cross-corpus-rrf.ts` -- UnifiedRetrievalChunk type, RRF scoring
- `src/knowledge/wiki-store.ts` -- WikiPageStore interface, `page_id` / `last_modified` columns
- `src/db/migrations/006-wiki-pages.sql` -- wiki_pages schema (page_id, last_modified columns)
- `src/db/migrations/012-wiki-staleness-run-state.sql` -- Run state table pattern
- `src/db/client.ts` -- `Sql` type definition (postgres.js)
- `src/db/migrate.ts` -- Migration runner (file-based, sequential, `.sql` files)

### Secondary (MEDIUM confidence)
- [API:Linkshere - MediaWiki](https://www.mediawiki.org/wiki/API:Linkshere) -- Prop module for finding pages that link to a given page
- [API:Backlinks - MediaWiki](https://www.mediawiki.org/wiki/API:Backlinks) -- Alternative list module (linkshere is more appropriate for prop-based batch queries)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies needed; all libraries already in project
- Architecture: HIGH -- Every pattern needed already exists in the codebase with clear precedent
- Pitfalls: HIGH -- Identified from direct code reading of existing patterns and MediaWiki API behavior

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain, patterns unlikely to change)