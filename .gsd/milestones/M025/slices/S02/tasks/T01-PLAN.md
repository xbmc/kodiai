# T01: 121-page-popularity 01

**Slice:** S02 — **Milestone:** M025

## Description

Create the database schema, popularity store, config constants, and retrieval pipeline citation instrumentation for the wiki page popularity system.

Purpose: Establishes the data foundation (tables, store, config) and begins collecting citation frequency data immediately upon deployment. Citation events accumulate passively as the retrieval pipeline runs, so deploying this first maximizes the data window before the scorer runs.

Output: Two migration files, a popularity config module, a popularity store module, and citation logging wired into the retrieval pipeline.

## Must-Haves

- [ ] "Wiki citation events are logged to the database whenever wiki pages appear in retrieval results"
- [ ] "Citation logging never blocks or degrades retrieval pipeline latency"
- [ ] "wiki_page_popularity and wiki_citation_events tables exist with correct schema"
- [ ] "Popularity store can upsert scores and query top-N pages by composite score"

## Files

- `src/db/migrations/020-wiki-page-popularity.sql`
- `src/db/migrations/020-wiki-page-popularity.down.sql`
- `src/db/migrations/021-wiki-citation-events.sql`
- `src/db/migrations/021-wiki-citation-events.down.sql`
- `src/knowledge/wiki-popularity-config.ts`
- `src/knowledge/wiki-popularity-store.ts`
- `src/knowledge/retrieval.ts`
