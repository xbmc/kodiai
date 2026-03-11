# T02: 90-mediawiki-content-ingestion 02

**Slice:** S02 — **Milestone:** M018

## Description

Implement the MediaWiki API backfill engine and CLI for fetching all kodi.wiki pages, converting to markdown, chunking, embedding, and storing.

Purpose: Populate the wiki_pages table with all kodi.wiki content so it becomes searchable. This is the primary data ingestion path.
Output: Backfill engine module and CLI script with resume support, rate limiting, and progress logging.

## Must-Haves

- [ ] "All kodi.wiki pages can be fetched via MediaWiki API with proper pagination"
- [ ] "Backfill CLI resumes from last sync state on restart (cursor-based)"
- [ ] "Pages are fetched, HTML converted to markdown, chunked, embedded, and stored in wiki_pages table"
- [ ] "Rate limiting prevents overloading kodi.wiki MediaWiki API"
- [ ] "Redirect, stub, and disambiguation pages are skipped during backfill"
- [ ] "Progress is logged with page count and timing"

## Files

- `src/knowledge/wiki-backfill.ts`
- `src/knowledge/wiki-backfill.test.ts`
- `scripts/backfill-wiki.ts`
- `src/knowledge/index.ts`
- `package.json`
