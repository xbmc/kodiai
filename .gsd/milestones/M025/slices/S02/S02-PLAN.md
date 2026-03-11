# S02: Page Popularity

**Goal:** Create the database schema, popularity store, config constants, and retrieval pipeline citation instrumentation for the wiki page popularity system.
**Demo:** Create the database schema, popularity store, config constants, and retrieval pipeline citation instrumentation for the wiki page popularity system.

## Must-Haves


## Tasks

- [x] **T01: 121-page-popularity 01** `est:2min`
  - Create the database schema, popularity store, config constants, and retrieval pipeline citation instrumentation for the wiki page popularity system.

Purpose: Establishes the data foundation (tables, store, config) and begins collecting citation frequency data immediately upon deployment. Citation events accumulate passively as the retrieval pipeline runs, so deploying this first maximizes the data window before the scorer runs.

Output: Two migration files, a popularity config module, a popularity store module, and citation logging wired into the retrieval pipeline.
- [x] **T02: 121-page-popularity 02** `est:2min`
  - Build the linkshere API fetcher, composite popularity scorer with scheduler, and initial backfill script.

Purpose: Completes the popularity scoring system by adding the inbound links signal (POP-01), computing edit recency (POP-03), combining all signals into a composite score (POP-04), and providing both scheduled refresh and one-time backfill capabilities.

Output: Three new modules — a linkshere fetcher, a scorer with scheduler, and a backfill script.
- [x] **T03: 121-page-popularity 03** `est:1min`
  - Wire the popularity store and scorer into the application bootstrap to close two verification gaps.

Purpose: The popularity store (citation logger) and scorer (scheduled refresh) are fully implemented but never instantiated in src/index.ts. Without this wiring, no citation events accumulate in production and popularity scores never auto-refresh. This is ~15 lines of bootstrap code following established patterns.

Output: Modified src/index.ts with popularity store created, passed as wikiCitationLogger to createRetriever, scorer instantiated and started, and shutdown ref stored.

## Files Likely Touched

- `src/db/migrations/020-wiki-page-popularity.sql`
- `src/db/migrations/020-wiki-page-popularity.down.sql`
- `src/db/migrations/021-wiki-citation-events.sql`
- `src/db/migrations/021-wiki-citation-events.down.sql`
- `src/knowledge/wiki-popularity-config.ts`
- `src/knowledge/wiki-popularity-store.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/wiki-linkshere-fetcher.ts`
- `src/knowledge/wiki-popularity-scorer.ts`
- `src/knowledge/wiki-popularity-backfill.ts`
- `src/index.ts`
