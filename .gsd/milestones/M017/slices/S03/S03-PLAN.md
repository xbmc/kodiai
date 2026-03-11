# S03: Knowledge Layer Extraction

**Goal:** Create the unified `src/knowledge/` module with `retrieval.
**Demo:** Create the unified `src/knowledge/` module with `retrieval.

## Must-Haves


## Tasks

- [x] **T01: 88-knowledge-layer-extraction 01** `est:7min`
  - Create the unified `src/knowledge/` module with `retrieval.ts` and `embeddings.ts` as the sole entry points for retrieval and embedding operations.

Purpose: Consolidate all retrieval pipeline logic (variant building, embedding, isolation, reranking, recency weighting, adaptive thresholds, snippet anchoring) into a single `retrieve()` function so callers pass text queries in and get ranked results out.

Output: `src/knowledge/retrieval.ts`, `src/knowledge/embeddings.ts`, `src/knowledge/index.ts`, and all supporting files moved from `src/learning/` to `src/knowledge/`.
- [x] **T02: 88-knowledge-layer-extraction 02** `est:10min`
  - Wire all handlers (review, mention, Slack assistant) to use the unified `src/knowledge/` module, add Slack retrieval support, write the E2E test, and delete `src/learning/` entirely.

Purpose: Complete the knowledge layer extraction by making all consumers use the unified module, proving shared code path with an E2E test, and removing the old `src/learning/` directory.

Output: Refactored handlers, Slack retrieval, E2E test, deleted `src/learning/`.

## Files Likely Touched

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
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/slack/assistant-handler.ts`
- `src/index.ts`
- `src/learning/`
