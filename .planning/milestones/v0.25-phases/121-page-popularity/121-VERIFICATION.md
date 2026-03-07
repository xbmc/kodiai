---
phase: 121-page-popularity
verified: 2026-03-03T18:25:00Z
status: passed
score: 10/10 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 8/10
  gaps_closed:
    - "Wiki citation events are logged to the database whenever wiki pages appear in retrieval results"
    - "The popularity scorer runs on a weekly schedule matching the staleness detector pattern"
  gaps_remaining: []
  regressions: []
---

# Phase 121: Page Popularity Verification Report

**Phase Goal:** Every wiki page has a composite popularity score combining inbound links, citation frequency, and edit recency, enabling principled top-N page selection
**Verified:** 2026-03-03T18:25:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plan 121-03, commit 37a27f6bf8)

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Wiki citation events logged to DB whenever wiki pages appear in retrieval results | VERIFIED | `wikiCitationLogger: popularityStore` wired at src/index.ts:259; fire-and-forget at retrieval.ts:817-822 |
| 2  | Citation logging never blocks or degrades retrieval pipeline latency | VERIFIED | `void deps.wikiCitationLogger.logCitations(wikiPageIds).catch(...)` at retrieval.ts:819 — fail-open |
| 3  | wiki_page_popularity and wiki_citation_events tables exist with correct schema | VERIFIED | Both migration files present with all required columns and indexes |
| 4  | Popularity store can upsert scores and query top-N pages by composite score | VERIFIED | wiki-popularity-store.ts exports all 6 methods including getTopPages with ORDER BY composite_score DESC |
| 5  | Inbound link counts from MediaWiki linkshere API are stored for every wiki page | VERIFIED | wiki-linkshere-fetcher.ts implements batching (50/req), pagination (lhcontinue), rate limiting (500ms) |
| 6  | Edit recency is computed using exponential decay from last_modified timestamp | VERIFIED | computeCompositeScore in wiki-popularity-config.ts: `Math.exp(-RECENCY_LAMBDA * daysSinceEdit)` |
| 7  | A composite popularity score exists per page combining all three signals | VERIFIED | computeCompositeScore: min-max normalized inbound links (0.3) + citation frequency (0.5) + edit recency (0.2) = 1.0 |
| 8  | Top-N pages by popularity score return deterministic ordered result | VERIFIED | getTopPages() uses `ORDER BY composite_score DESC LIMIT N` with idx_wiki_page_popularity_score backing it |
| 9  | The popularity scorer runs on a weekly schedule matching the staleness detector pattern | VERIFIED | createWikiPopularityScorer instantiated at src/index.ts:588-600 with .start() called; `_wikiPopularityScorerRef` pattern matches staleness detector |
| 10 | Popularity scorer is stopped on graceful shutdown | VERIFIED | `_wikiPopularityScorerRef?.stop()` at src/index.ts:121 in shutdownManager.closeDb |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/migrations/020-wiki-page-popularity.sql` | Page popularity table schema | VERIFIED | page_id UNIQUE, inbound_links, citation_count, edit_recency_score, composite_score, freshness timestamps, both indexes |
| `src/db/migrations/020-wiki-page-popularity.down.sql` | Down migration | VERIFIED | `DROP TABLE IF EXISTS wiki_page_popularity` |
| `src/db/migrations/021-wiki-citation-events.sql` | Citation event log table schema | VERIFIED | page_id, cited_at, idx on (page_id, cited_at), idx on (cited_at) |
| `src/db/migrations/021-wiki-citation-events.down.sql` | Down migration | VERIFIED | `DROP TABLE IF EXISTS wiki_citation_events` |
| `src/knowledge/wiki-popularity-config.ts` | Weight constants, lambda, citation window, linkshere settings | VERIFIED | POPULARITY_WEIGHTS (0.3/0.5/0.2), RECENCY_HALF_LIFE_DAYS=90, CITATION_WINDOW_DAYS=90, computeCompositeScore |
| `src/knowledge/wiki-popularity-store.ts` | CRUD for popularity and citation tables | VERIFIED | All 6 methods; batch upsert groups of 100; deduplicates page_ids before INSERT |
| `src/knowledge/retrieval.ts` | Fire-and-forget citation logging after cross-corpus dedup | VERIFIED | Code at lines 817-822 correct and wikiCitationLogger now passed from src/index.ts:259 |
| `src/knowledge/wiki-linkshere-fetcher.ts` | MediaWiki linkshere API client with batching and pagination | VERIFIED | Exports fetchAllLinkshereCounts with all required features |
| `src/knowledge/wiki-popularity-scorer.ts` | Composite scoring logic and scheduled refresh job | VERIFIED | Instantiated at src/index.ts:588, .start() called at line 595, shutdown ref at line 596 |
| `src/knowledge/wiki-popularity-backfill.ts` | One-time initial population script | VERIFIED | Standalone script, imports all deps, calls scorer.runNow(), prints top 10 pages |
| `src/index.ts` | Application bootstrap wiring for store, citation logger, scorer | VERIFIED | Imports at lines 29-30; shutdown ref at 111; stop at 121; store at 234; citation logger at 259; scorer at 588-600 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.ts` | `src/knowledge/wiki-popularity-store.ts` | `createWikiPopularityStore` instantiation passed as `wikiCitationLogger` | VERIFIED | `const popularityStore = createWikiPopularityStore(...)` at line 234; passed at line 259 |
| `src/knowledge/retrieval.ts` | `src/knowledge/wiki-popularity-store.ts` | `deps.wikiCitationLogger.logCitations` fire-and-forget | VERIFIED | Line 817 guard + line 819 call; wikiCitationLogger now provided from index.ts |
| `src/knowledge/wiki-popularity-store.ts` | `src/db/migrations/021-wiki-citation-events.sql` | INSERT into wiki_citation_events | VERIFIED | logCitations() uses `INSERT INTO wiki_citation_events` |
| `src/index.ts` | `src/knowledge/wiki-popularity-scorer.ts` | `createWikiPopularityScorer` instantiation + `.start()` | VERIFIED | Import at line 30; instantiation at lines 588-594; `.start()` at line 595; ref at line 596 |
| `src/knowledge/wiki-popularity-scorer.ts` | `src/knowledge/wiki-linkshere-fetcher.ts` | `fetchAllLinkshereCounts` call during scoring | VERIFIED | Import at scorer line 21, called during runScoring() |
| `src/knowledge/wiki-popularity-scorer.ts` | `src/knowledge/wiki-popularity-store.ts` | `getCitationCounts` + `upsertPopularity` calls | VERIFIED | Both methods called in runScoring() |
| `src/knowledge/wiki-popularity-scorer.ts` | `src/knowledge/wiki-popularity-config.ts` | imports weight constants, lambda, window config | VERIFIED | CITATION_WINDOW_DAYS and computeCompositeScore imported and used |
| `src/index.ts` (shutdownManager) | `_wikiPopularityScorerRef` | `.stop()` on graceful shutdown | VERIFIED | `_wikiPopularityScorerRef?.stop()` at line 121 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| POP-01 | 121-02-PLAN | MediaWiki inbound link counts fetched via linkshere API for all wiki pages | SATISFIED | wiki-linkshere-fetcher.ts fully implements batched linkshere fetching; scorer calls fetchAllLinkshereCounts |
| POP-02 | 121-01-PLAN | Retrieval citation frequency tracked — counts how often each wiki page appears in retrieval results | SATISFIED | Citation logging code in retrieval.ts:817-822 now wired in production via wikiCitationLogger: popularityStore at index.ts:259 |
| POP-03 | 121-01-PLAN, 121-02-PLAN | Edit recency captured as a popularity signal | SATISFIED | computeCompositeScore uses exponential decay; scorer extracts last_modified, computes daysSinceEdit, applies decay |
| POP-04 | 121-02-PLAN | Composite popularity score combining inbound links, citation frequency, and edit recency | SATISFIED | computeCompositeScore weighted sum (0.3/0.5/0.2) with min-max normalization verified in wiki-popularity-config.ts |

No orphaned requirements found. All four POP-* requirements are satisfied.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments found in phase files. No stub implementations. No orphaned modules. Build compiles without errors.

### Human Verification Required

None — all gaps were code-level wiring issues that have been verified programmatically.

### Re-Verification Summary

Both gaps from the initial verification were closed by plan 121-03 (commit `37a27f6bf8`):

**Gap 1 (POP-02 — citation logging not wired):** `src/index.ts` now creates `const popularityStore = createWikiPopularityStore({ sql, logger })` at line 234, declared unconditionally outside the `isolationLayer && embeddingProvider` conditional so it is accessible to both the retriever and the scorer. It is passed as `wikiCitationLogger: popularityStore` to `createRetriever()` at line 259. Citation events now accumulate in production.

**Gap 2 (scorer never started):** `createWikiPopularityScorer` is now imported at line 30, instantiated at lines 588-594 with all required deps (`sql`, `logger`, `wikiPageStore`, `popularityStore`, `wikiBaseUrl`), started with `.start()` at line 595, and its reference stored at `_wikiPopularityScorerRef` line 596. The `_wikiPopularityScorerRef?.stop()` call at line 121 handles graceful shutdown. The wiring exactly mirrors the staleness detector pattern as specified.

No regressions detected on previously-passing items.

---

_Verified: 2026-03-03T18:25:00Z_
_Verifier: Claude (gsd-verifier)_
