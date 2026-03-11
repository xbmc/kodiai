# T03: 90-mediawiki-content-ingestion 03

**Slice:** S02 — **Milestone:** M018

## Description

Implement daily incremental sync for kodi.wiki changes and wire wiki corpus into the retrieval pipeline with citation formatting.

Purpose: Keep wiki content fresh and make it actionable -- the bot should surface wiki knowledge when answering architecture/feature questions about Kodi.
Output: Scheduled sync module, wiki retrieval search function, updated retriever pipeline, and citation formatting in review prompt.

## Must-Haves

- [ ] "Daily scheduled sync detects changed kodi.wiki pages via RecentChanges API and re-ingests them"
- [ ] "Wiki corpus is searchable via the existing createRetriever() pipeline alongside learning memories and review comments"
- [ ] "Wiki retrieval results include source attribution: page title, section heading, URL with anchor, last modified date"
- [ ] "Bot can answer architecture/feature questions with wiki citations formatted as inline links"
- [ ] "Citation format includes freshness indicator: [Wiki] Page Title > Section (updated YYYY-MM)"
- [ ] "Wiki retrieval is fail-open: errors degrade gracefully without blocking review"

## Files

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
