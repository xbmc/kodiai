# T01: 88-knowledge-layer-extraction 01

**Slice:** S03 — **Milestone:** M017

## Description

Create the unified `src/knowledge/` module with `retrieval.ts` and `embeddings.ts` as the sole entry points for retrieval and embedding operations.

Purpose: Consolidate all retrieval pipeline logic (variant building, embedding, isolation, reranking, recency weighting, adaptive thresholds, snippet anchoring) into a single `retrieve()` function so callers pass text queries in and get ranked results out.

Output: `src/knowledge/retrieval.ts`, `src/knowledge/embeddings.ts`, `src/knowledge/index.ts`, and all supporting files moved from `src/learning/` to `src/knowledge/`.

## Must-Haves

- [ ] "src/knowledge/retrieval.ts exports a retrieve() function that accepts text queries and returns ranked results"
- [ ] "src/knowledge/embeddings.ts exports embedding creation and provider initialization"
- [ ] "Multi-query is first-class: retrieve() accepts string[] queries and handles variant execution internally"
- [ ] "All reranking, recency weighting, and adaptive threshold logic runs inside retrieve(), not in callers"

## Files

- `src/knowledge/retrieval.ts`
- `src/knowledge/embeddings.ts`
- `src/knowledge/index.ts`
- `src/knowledge/isolation.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/adaptive-threshold.ts`
- `src/knowledge/retrieval-rerank.ts`
- `src/knowledge/retrieval-recency.ts`
- `src/knowledge/retrieval-snippets.ts`
- `src/knowledge/multi-query-retrieval.ts`
- `src/knowledge/retrieval-query.ts`
