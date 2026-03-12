---
estimated_steps: 4
estimated_files: 2
---

# T01: Write docs/knowledge-system.md

**Slice:** S04 — Knowledge System & Feature Docs
**Milestone:** M026

## Description

Write comprehensive documentation for the knowledge system — the 5-corpus retrieval pipeline that powers Kodiai's context-aware reviews and responses. This is the largest documentation target in S04 (60+ source files) and the primary deliverable for R010. The architecture.md forward link to this file must resolve after this task.

## Steps

1. Read key source files to understand the current retrieval pipeline: `src/knowledge/retrieval.ts` (unified pipeline), `src/knowledge/cross-corpus-rrf.ts` (cross-corpus RRF), `src/knowledge/hybrid-search.ts` (per-corpus RRF), `src/knowledge/types.ts` (canonical types), `src/knowledge/embeddings.ts` (Voyage AI provider), `src/knowledge/multi-query-retrieval.ts` (variant system)
2. Read corpus-specific files: each store (memory-store, review-comment-store, wiki-store, code-snippet-store, issue-store), chunkers (review-comment-chunker, wiki-chunker, code-snippet-chunker, issue-comment-chunker), and retrieval modules
3. Read supporting modules: `adaptive-threshold.ts`, `dedup.ts`, `retrieval-rerank.ts`, `retrieval-recency.ts`, `retrieval-snippets.ts`, `isolation.ts`, and background systems (`wiki-sync.ts`, `wiki-staleness-detector.ts`, `cluster-pipeline.ts`)
4. Write `docs/knowledge-system.md` following S03 documentation patterns: overview paragraph → 5-corpus table (corpus, store, chunker, embedding model, description) → chunking strategies → embedding models (voyage-code-3 vs voyage-context-3) → unified retrieval pipeline (numbered steps) → two-stage RRF (per-corpus hybrid + cross-corpus) → dedup (Jaccard similarity) → adaptive thresholds → language-aware reranking → recency weighting → snippet anchoring → repo isolation → background systems (wiki sync, staleness detection, clustering) → configuration reference pointing to configuration.md. Include cross-links to architecture.md

## Must-Haves

- [ ] 5-corpus table with store, chunker, embedding model for each
- [ ] Unified retrieval pipeline flow with numbered steps
- [ ] Two-stage RRF explanation (per-corpus hybrid + cross-corpus merge)
- [ ] Background systems section (wiki sync, staleness, clustering)
- [ ] Cross-links to architecture.md and configuration.md
- [ ] Content accurate to current source code (not aspirational)

## Verification

- `test -f docs/knowledge-system.md` — file exists
- `grep -c '##' docs/knowledge-system.md` ≥ 8 — substantive structure
- `grep -l 'architecture.md' docs/knowledge-system.md` — cross-link present
- `grep -l 'configuration.md' docs/knowledge-system.md` — cross-link present
- `grep -l 'RRF\|rrf' docs/knowledge-system.md` — RRF documented

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: Read docs/knowledge-system.md
- Failure state exposed: None

## Inputs

- `docs/architecture.md` — knowledge system overview paragraph and forward link to this file
- `docs/configuration.md` — config reference target for knowledge.* settings
- S04-RESEARCH.md corpus table, source file listing, and key design details

## Expected Output

- `docs/knowledge-system.md` — comprehensive documentation of the 5-corpus retrieval pipeline, resolving the forward link from architecture.md
