# Requirements: Kodiai

**Defined:** 2026-02-24
**Core Value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Source:** [Issue #65](https://github.com/xbmc/kodiai/issues/65) — Milestone 2: Knowledge Ingestion

## v0.18 Requirements

Requirements for v0.18 Knowledge Ingestion — PR Comments, Wiki, Cross-Corpus Retrieval.

### PR Review Comment Ingestion

- [x] **KI-01**: 18 months of human PR review comments from xbmc/xbmc backfilled, chunked, embedded, and stored in PostgreSQL
- [x] **KI-02**: Review comments stored with metadata: PR number, file, line range, author, date
- [x] **KI-03**: Semantic chunking at per-comment/per-thread boundaries with overlapping sliding windows (512 tokens, 128 overlap) for long threads
- [ ] **KI-04**: Incremental sync ingests new review comments on PR close/merge via webhook
- [ ] **KI-05**: Review comment corpus available via `src/knowledge/retrieval.ts` retrieval path
- [ ] **KI-06**: Bot can cite human review precedents ("reviewers have historically flagged this pattern") in responses

### MediaWiki Content Ingestion

- [ ] **KI-07**: kodi.wiki content exported via MediaWiki API (all pages or targeted namespaces)
- [ ] **KI-08**: HTML stripped to markdown, chunked by section heading with overlapping windows
- [ ] **KI-09**: Wiki chunks stored with metadata: page title, section, last modified, URL
- [ ] **KI-10**: Incremental sync via scheduled job (daily/weekly) detects changed pages
- [ ] **KI-11**: Wiki corpus available via `src/knowledge/retrieval.ts` retrieval path
- [ ] **KI-12**: Bot can answer architecture/feature questions with wiki citations and links

### Cross-Corpus Retrieval Integration

- [ ] **KI-13**: Single retrieval call fans out to code, review comments, and wiki simultaneously
- [ ] **KI-14**: Hybrid search combining pgvector semantic similarity with PostgreSQL tsvector full-text search per corpus
- [ ] **KI-15**: Reciprocal Rank Fusion (RRF) merges ranked lists from heterogeneous sources using `1/(k + rank)` scoring
- [ ] **KI-16**: Source-aware re-ranking weights results by recency, source type, and relevance score
- [ ] **KI-17**: Every retrieved chunk carries source label (code / review / wiki) for attribution
- [ ] **KI-18**: Context assembly respects token budget with attributed chunks
- [ ] **KI-19**: Near-duplicate chunks from different sources collapsed via cosine similarity threshold

### Success Criteria (from Issue #65)

- [ ] 18 months of review comments indexed and returning results in retrieval
- [ ] kodi.wiki fully indexed with incremental sync running on schedule
- [ ] Single retrieval call fans out to all corpora with source attribution in responses
- [ ] Hybrid search (BM25 + vector) operational with RRF merging across sources
- [ ] Chunking uses semantic boundaries with overlap, not naive fixed-size splits

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-encoder reranker (Cohere Rerank) | Implement only if RRF + hybrid search doesn't achieve sufficient precision |
| HyDE (Hypothetical Document Embedding) | Nice-to-have; deferred unless colloquial vs technical vocabulary gap is measured |
| Non-xbmc/xbmc repo backfill | Single repo backfill for v0.18; extend later |
| Real-time streaming wiki sync | Scheduled batch sync sufficient for wiki change frequency |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| KI-01 | Phase 89 | Complete |
| KI-02 | Phase 89 | Complete |
| KI-03 | Phase 89 | Complete |
| KI-04 | Phase 89 | Pending |
| KI-05 | Phase 89 | Pending |
| KI-06 | Phase 89 | Pending |
| KI-07 | Phase 90 | Pending |
| KI-08 | Phase 90 | Pending |
| KI-09 | Phase 90 | Pending |
| KI-10 | Phase 90 | Pending |
| KI-11 | Phase 90 | Pending |
| KI-12 | Phase 90 | Pending |
| KI-13 | Phase 91 | Pending |
| KI-14 | Phase 91 | Pending |
| KI-15 | Phase 91 | Pending |
| KI-16 | Phase 91 | Pending |
| KI-17 | Phase 91 | Pending |
| KI-18 | Phase 91 | Pending |
| KI-19 | Phase 91 | Pending |

**Coverage:**
- v0.18 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-02-24*
*Source: GitHub Issue #65*
