# S02: Mediawiki Content Ingestion

**Goal:** Create the PostgreSQL schema, store module, and chunking logic for MediaWiki content ingestion.
**Demo:** Create the PostgreSQL schema, store module, and chunking logic for MediaWiki content ingestion.

## Must-Haves


## Tasks

- [x] **T01: 90-mediawiki-content-ingestion 01** `est:8min`
  - Create the PostgreSQL schema, store module, and chunking logic for MediaWiki content ingestion.

Purpose: Establish the data layer that backfill (Plan 02) and retrieval integration (Plan 03) depend on. Schema must support full metadata, vector search, and section-level granularity.
Output: Migration file, store module with write/read/search operations, type definitions, and section-based chunker with HTML-to-markdown conversion.
- [x] **T02: 90-mediawiki-content-ingestion 02** `est:6min`
  - Implement the MediaWiki API backfill engine and CLI for fetching all kodi.wiki pages, converting to markdown, chunking, embedding, and storing.

Purpose: Populate the wiki_pages table with all kodi.wiki content so it becomes searchable. This is the primary data ingestion path.
Output: Backfill engine module and CLI script with resume support, rate limiting, and progress logging.
- [x] **T03: 90-mediawiki-content-ingestion 03** `est:12min`
  - Implement daily incremental sync for kodi.wiki changes and wire wiki corpus into the retrieval pipeline with citation formatting.

Purpose: Keep wiki content fresh and make it actionable -- the bot should surface wiki knowledge when answering architecture/feature questions about Kodi.
Output: Scheduled sync module, wiki retrieval search function, updated retriever pipeline, and citation formatting in review prompt.

## Files Likely Touched

- `src/db/migrations/006-wiki-pages.sql`
- `src/db/migrations/006-wiki-pages.down.sql`
- `src/knowledge/wiki-types.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/wiki-store.test.ts`
- `src/knowledge/wiki-chunker.ts`
- `src/knowledge/wiki-chunker.test.ts`
- `src/knowledge/wiki-backfill.ts`
- `src/knowledge/wiki-backfill.test.ts`
- `scripts/backfill-wiki.ts`
- `src/knowledge/index.ts`
- `package.json`
- `src/knowledge/wiki-sync.ts`
- `src/knowledge/wiki-sync.test.ts`
- `src/knowledge/wiki-retrieval.ts`
- `src/knowledge/wiki-retrieval.test.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/retrieval.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/knowledge/index.ts`
- `src/index.ts`
