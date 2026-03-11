---
id: M018
milestone: M018
verification_result: passed
completed_at: migrated
---

# M018: Knowledge Ingestion

**Migrated from v0.18 milestone summary**

## What Happened

## v0.18 Knowledge Ingestion (Shipped: 2026-02-25)

**Scope:** 4 phases (89-92), 15 plans
**Timeline:** 2026-02-24 → 2026-02-25
**Source:** [Issue #65](https://github.com/xbmc/kodiai/issues/65)
**Files modified:** 45 (8,789 insertions, 72 deletions)

**Key accomplishments:**
- 18 months of xbmc/xbmc PR review comments backfilled with thread-aware chunking, embedded via Voyage AI, and searchable with inline precedent citations
- kodi.wiki fully exported via MediaWiki API with section-based HTML-to-markdown chunking, scheduled incremental sync, and wiki citations in bot responses
- Hybrid BM25+vector search per corpus using existing tsvector GIN indexes with Reciprocal Rank Fusion merging across heterogeneous sources
- Unified cross-corpus retrieval pipeline: single call fans out to code, review comments, and wiki with source-aware re-ranking and cosine deduplication
- All consumers wired to unified retrieval — @mention flow includes [wiki: Page] / [review: PR #] citations, review retry preserves full context, code corpus gets hybrid search
- 19/19 requirements verified and satisfied; all v0.18 audit gaps closed

---
