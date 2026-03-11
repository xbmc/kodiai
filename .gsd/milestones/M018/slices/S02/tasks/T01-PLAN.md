# T01: 90-mediawiki-content-ingestion 01

**Slice:** S02 — **Milestone:** M018

## Description

Create the PostgreSQL schema, store module, and chunking logic for MediaWiki content ingestion.

Purpose: Establish the data layer that backfill (Plan 02) and retrieval integration (Plan 03) depend on. Schema must support full metadata, vector search, and section-level granularity.
Output: Migration file, store module with write/read/search operations, type definitions, and section-based chunker with HTML-to-markdown conversion.

## Must-Haves

- [ ] "knowledge.wiki_pages table exists in PostgreSQL with pgvector embedding column and all required metadata columns"
- [ ] "Wiki pages can be stored with full metadata: page title, section heading, last modified date, URL, and namespace"
- [ ] "Section-based chunking splits pages at heading boundaries (## / ###) with 1024-token sliding window and 256-token overlap for large sections"
- [ ] "HNSW index on wiki_pages.embedding enables cosine similarity search"
- [ ] "Wiki markup (tables, templates, infoboxes) is stripped to plain text; code blocks preserved as-is"
- [ ] "Page title + section heading prepended as prefix to chunk text before embedding"

## Files

- `src/db/migrations/006-wiki-pages.sql`
- `src/db/migrations/006-wiki-pages.down.sql`
- `src/knowledge/wiki-types.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/wiki-store.test.ts`
- `src/knowledge/wiki-chunker.ts`
- `src/knowledge/wiki-chunker.test.ts`
