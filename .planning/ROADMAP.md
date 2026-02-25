# Roadmap: Kodiai

## Milestones

- ✅ **v0.1 MVP** — Phases 1-10 (shipped 2026-02-09)
- ✅ **v0.2 Write Mode** — Phases 11-21 (shipped 2026-02-10)
- ✅ **v0.3 Configuration & Observability** — Phases 22-25 (shipped 2026-02-11)
- ✅ **v0.4 Intelligent Review System** — Phases 26-29 (shipped 2026-02-12)
- ✅ **v0.5 Advanced Learning & Language Support** — Phases 30-33 (shipped 2026-02-13)
- ✅ **v0.6 Review Output Formatting & UX** — Phases 34-38 (shipped 2026-02-14)
- ✅ **v0.7 Intelligent Review Content** — Phases 39-41 (shipped 2026-02-14)
- ✅ **v0.8 Conversational Intelligence** — Phases 42-50 (shipped 2026-02-14)
- ✅ **v0.9 Smart Dependencies & Resilience** — Phases 51-55 (shipped 2026-02-15)
- ✅ **v0.10 Advanced Signals** — Phases 56-59 (shipped 2026-02-16)
- ✅ **v0.11 Issue Workflows** — Phases 60-65 (shipped 2026-02-16)
- ✅ **v0.12 Operator Reliability & Retrieval Quality** — Phases 66-71 (shipped 2026-02-17)
- ✅ **v0.13 Reliability Follow-Through** — Phases 72-76 (force-closed 2026-02-18; accepted debt)
- ✅ **v0.14 Slack Integration** — Phases 77-80 (shipped 2026-02-19)
- ✅ **v0.15 Slack Write Workflows** — Phase 81 (shipped 2026-02-19)
- ✅ **v0.16 Review Coverage & Slack UX** — Phases 82-85 (shipped 2026-02-24)
- ✅ **v0.17 Infrastructure Foundation** — Phases 86-88 (shipped 2026-02-24)

## Active: v0.18 Knowledge Ingestion (Phases 89-91)

**Source:** [Issue #65](https://github.com/xbmc/kodiai/issues/65)

### Phase 89 — PR Review Comment Ingestion
**Goal:** 18 months of human review comments from xbmc/xbmc embedded and searchable
**Requirements:** KI-01 through KI-06
**Plans:** 2/4 plans executed

Plans:
- [ ] 89-01-PLAN.md — Schema, store, and thread-aware chunker for review comments
- [ ] 89-02-PLAN.md — Backfill CLI with GitHub API pagination and rate limiting
- [ ] 89-03-PLAN.md — Incremental webhook sync for review comment lifecycle
- [ ] 89-04-PLAN.md — Retrieval integration and inline citation formatting

**Scope:**
- GitHub API backfill: fetch all PR review comments from xbmc/xbmc (18 months)
- Chunk and embed review comments with metadata: PR number, file, line range, author, date
- `knowledge.review_comments` table in PostgreSQL with pgvector embeddings
- Semantic chunking at per-comment/per-thread boundaries with overlapping sliding windows (1024 tokens, 256 overlap)
- Incremental sync: webhook handler ingests new review comments on create/edit/delete
- Retrieval integration: review comment corpus available via `src/knowledge/retrieval.ts`
- Validation: bot cites human review precedents in responses

**Deliverable:** Human review comments are a first-class retrieval source; bot surfaces "reviewers have historically flagged this pattern" evidence.

### Phase 90 — MediaWiki Content Ingestion
**Goal:** kodi.wiki content chunked, embedded, and searchable
**Requirements:** KI-07 through KI-12

**Scope:**
- MediaWiki API export: fetch all pages from kodi.wiki (or targeted namespaces)
- HTML → markdown stripping; chunk by section heading with overlapping windows
- Embed and store with metadata: page title, section, last modified, URL
- `knowledge.wiki_pages` table in PostgreSQL with pgvector embeddings
- Incremental sync: scheduled job (daily/weekly) detects changed pages
- Retrieval integration: wiki corpus available via `src/knowledge/retrieval.ts`
- Validation: bot answers architecture/feature questions with wiki citations

**Deliverable:** kodi.wiki is searchable; bot responses cite wiki pages with links.

### Phase 91 — Cross-Corpus Retrieval Integration
**Goal:** Unified retrieval across all knowledge sources with source-aware ranking
**Requirements:** KI-13 through KI-19
**Depends on:** Phases 89, 90

**Scope:**
- Multi-source query fan-out: single retrieval call queries code, review comments, wiki simultaneously
- Hybrid search (BM25 + vector): combine pgvector semantic similarity with PostgreSQL tsvector full-text search per corpus
- Reciprocal Rank Fusion (RRF): merge ranked lists using `1/(k + rank)` per list, summed across lists
- Source-aware re-ranking: weight by recency, source type, and relevance score
- Result attribution: every retrieved chunk carries source label (code / review / wiki)
- Context assembly: build LLM context window with attributed chunks, respect token budget
- Deduplication: collapse near-duplicate chunks via cosine similarity threshold on pgvector results
- End-to-end test: PR review response cites code context + human review precedent + wiki page

**Deliverable:** All three corpora queried on every retrieval call; responses cite sources by type; no retrieval path bypasses the unified layer.

---

## Phases

<details>
<summary>v0.1 MVP (Phases 1-10) -- SHIPPED 2026-02-09</summary>

See `.planning/milestones/v0.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.2 Write Mode (Phases 11-21) -- SHIPPED 2026-02-10</summary>

See `.planning/milestones/v0.2-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.3 Configuration & Observability (Phases 22-25) -- SHIPPED 2026-02-11</summary>

See `.planning/milestones/v0.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.4 Intelligent Review System (Phases 26-29) -- SHIPPED 2026-02-12</summary>

See `.planning/milestones/v0.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.5 Advanced Learning & Language Support (Phases 30-33) -- SHIPPED 2026-02-13</summary>

See `.planning/milestones/v0.5-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.6 Review Output Formatting & UX (Phases 34-38) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.6-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.7 Intelligent Review Content (Phases 39-41) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.7-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.8 Conversational Intelligence (Phases 42-50) -- SHIPPED 2026-02-14</summary>

See `.planning/milestones/v0.8-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.9 Smart Dependencies & Resilience (Phases 51-55) -- SHIPPED 2026-02-15</summary>

See `.planning/milestones/v0.9-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.10 Advanced Signals (Phases 56-59) -- SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.10-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.11 Issue Workflows (Phases 60-65) -- SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.11-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.12 Operator Reliability & Retrieval Quality (Phases 66-71) -- SHIPPED 2026-02-17</summary>

See `.planning/milestones/v0.12-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.13 Reliability Follow-Through (Phases 72-76) -- FORCE-CLOSED 2026-02-18</summary>

See `.planning/milestones/v0.13-ROADMAP.md` for full phase details, accepted gaps, and deferred follow-up scope.

</details>

<details>
<summary>v0.14 Slack Integration (Phases 77-80) -- SHIPPED 2026-02-19</summary>

See `.planning/milestones/v0.14-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.15 Slack Write Workflows (Phase 81) -- SHIPPED 2026-02-19</summary>

See `.planning/milestones/v0.15-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.16 Review Coverage & Slack UX (Phases 82-85) -- SHIPPED 2026-02-24</summary>

See `.planning/milestones/v0.16-ROADMAP.md` for full phase details.

</details>

<details>
<summary>v0.17 Infrastructure Foundation (Phases 86-88) -- SHIPPED 2026-02-24</summary>

See `.planning/milestones/v0.17-ROADMAP.md` for full phase details.

</details>

## Progress

**Total shipped:** 17 milestones, 88 phases, 212 plans
**Active:** v0.18 Knowledge Ingestion — Phases 89-91

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-10 | v0.1 | 27/27 | Complete | 2026-02-09 |
| 11-21 | v0.2 | 30/30 | Complete | 2026-02-10 |
| 22-25 | v0.3 | 7/7 | Complete | 2026-02-11 |
| 26-29 | v0.4 | 17/17 | Complete | 2026-02-12 |
| 30-33 | v0.5 | 12/12 | Complete | 2026-02-13 |
| 34-38 | v0.6 | 10/10 | Complete | 2026-02-14 |
| 39-41 | v0.7 | 11/11 | Complete | 2026-02-14 |
| 42-50 | v0.8 | 19/19 | Complete | 2026-02-14 |
| 51-55 | v0.9 | 11/11 | Complete | 2026-02-15 |
| 56-59 | v0.10 | 11/11 | Complete | 2026-02-16 |
| 60-65 | v0.11 | 14/14 | Complete | 2026-02-16 |
| 66-71 | v0.12 | 11/11 | Complete | 2026-02-17 |
| 72-76 | v0.13 | 6/6 | Complete | 2026-02-18 |
| 77-80 | v0.14 | 8/8 | Complete | 2026-02-19 |
| 81 | v0.15 | 4/4 | Complete | 2026-02-19 |
| 82-85 | v0.16 | 6/6 | Complete | 2026-02-24 |
| 86-88 | v0.17 | 8/8 | Complete | 2026-02-24 |

---

*Roadmap updated: 2026-02-24 -- v0.18 milestone created from Issue #65*
