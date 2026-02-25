# Phase 90: MediaWiki Content Ingestion - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Fetch kodi.wiki content via MediaWiki API, convert to markdown, chunk by section, embed with VoyageAI, and store in PostgreSQL with pgvector. Provide a CLI for initial backfill and in-process scheduled sync for ongoing freshness. Wire into existing `src/knowledge/retrieval.ts` so wiki content is searchable alongside review comments and code.

Cross-corpus retrieval unification (fan-out, RRF, source-aware re-ranking) belongs in Phase 91.

</domain>

<decisions>
## Implementation Decisions

### Content scope & filtering
- Ingest all namespaces (Main, Add-ons, Development, etc.) — cast the widest net
- Skip redirect pages, stubs (<500 characters), and disambiguation pages
- Minimum page size: 500 characters after HTML stripping
- No age filter — old wiki pages about architecture/APIs are still valuable for code understanding

### Chunking strategy
- Section-based with sliding window: split at section headings (## / ###), then apply sliding window within large sections
- Strip wiki markup to plain text: convert tables to text rows, remove template/infobox markup, preserve code blocks as-is
- 1024-token window, 256-token overlap — consistent with review comment chunker
- Prepend page title + section heading as prefix to chunk text before embedding (e.g., "Kodi > Settings > Audio: [chunk text]")

### Sync & freshness
- Use MediaWiki RecentChanges API to detect changed pages since last sync
- Daily sync frequency — kodi.wiki doesn't change rapidly
- On edit: delete old chunks for the page, re-chunk and re-embed entirely (no section-level diffing)
- Both CLI and in-process sync: CLI command (`npm run backfill:wiki`) for initial backfill, setInterval-based in-process job for ongoing daily sync

### Citation formatting
- Inline link with section anchor: "According to [Kodi Settings > Audio](https://kodi.wiki/view/Settings/Audio#section)..."
- Include last-modified date as freshness indicator: "[Kodi Audio Settings](url) (updated 2024-03)"
- Source label prefix to distinguish from other corpora: "[Wiki] Kodi Audio Settings" vs "[Review] PR #1234"
- Brief quote + link: "Per the wiki: \"Audio passthrough requires...\" ([source](url))" — gives context without clicking

### Claude's Discretion
- Exact HTML-to-markdown conversion approach
- MediaWiki API pagination strategy
- Table structure for `knowledge.wiki_pages` (column naming, index choices)
- Rate limiting approach for MediaWiki API
- How to handle pages with no meaningful text content after stripping

</decisions>

<specifics>
## Specific Ideas

- Pattern should mirror Phase 89's review comment pipeline: types.ts, store.ts, backfill.ts, sync handler, retrieval wiring
- Use same embedding model (voyage-code-3, 1024 dims) and same embedding persistence pattern (chunk.embedding in-place mutation)
- Backfill CLI should have similar UX to `npm run backfill:reviews` — cursor-based resume, progress logging, adaptive rate limiting

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 90-mediawiki-content-ingestion*
*Context gathered: 2026-02-25*
