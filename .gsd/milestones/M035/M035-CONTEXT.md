# M035: Voyage AI Model Upgrades — voyage-4 Embeddings + rerank-2.5

**Gathered:** 2026-04-04
**Status:** Ready for planning

## Project Description

Kodiai uses Voyage AI for all embedding and retrieval operations. Currently non-wiki corpora (learning memories, review comments, code snippets, issues) use `voyage-code-3`. Wiki uses `voyage-context-3` via the contextualized embeddings API. No neural reranker is used today — "reranking" is entirely custom heuristics (language-affinity multipliers + cross-corpus RRF scoring).

## Why This Milestone

voyage-4 is Voyage's latest general-purpose embedding series (MoE architecture, shared embedding space, same 1024-dim default). rerank-2.5 is their current recommended reranker with instruction-following. Both are straightforward upgrades with no API shape changes for the core path. The contextualized wiki API (`voyage-context-3`) has no voyage-4 equivalent — leave it alone.

## User-Visible Outcome

### When this milestone is complete:
- All non-wiki embeddings are generated with `voyage-4` (existing stale; repaired on next sweep)
- A Voyage reranker call (`rerank-2.5`) runs as the final cross-corpus ranking step after RRF in the retrieval pipeline
- Retrieval quality improves across all trigger types

### Entry point / environment
- Entry point: production service (`src/index.ts`) and backfill/repair scripts
- Environment: production (live Voyage API key required for both)
- Live dependencies: Voyage AI API (`/v1/embeddings`, `/v1/rerank`)

## Completion Class

- Contract complete means: model constants updated, reranker client wired in, embedding repair pipeline knows new target, tests pass
- Integration complete means: `createKnowledgeRuntime` boots with voyage-4 + reranker, retrieval pipeline calls reranker and falls back gracefully on error
- Operational complete means: stale embeddings in DB will be picked up by existing repair sweep on next run

## Final Integrated Acceptance

- Service boots with voyage-4 embedding provider and reranker, smoke test passes
- Retrieval returns results with reranked ordering (reranker score present on unified results)
- Reranker error causes fail-open (returns RRF-ranked results, not a crash)

## Risks and Unknowns

- `voyage-context-3` uses a separate `contextualizedembeddings` API endpoint — voyage-4 does NOT support that API. Wiki must stay on `voyage-context-3`. This is confirmed by Voyage docs.
- `voyage-4` dimensions are still 1024 by default (same as voyage-code-3) — no schema migration needed.
- The reranker is a new API call in the hot retrieval path — must be fail-open, and latency impact is unknown. The reranker input is the unified top-K text chunks (typically 5-10 items) so token volume is bounded.
- Hardcoded model strings in `review-comment-store.ts`, `code-snippet-store.ts`, and `wiki-store.ts` need updating alongside the constants.

## Existing Codebase / Prior Art

- `src/knowledge/runtime.ts` — `DEFAULT_EMBEDDING_MODEL = "voyage-code-3"`, `DEFAULT_WIKI_EMBEDDING_MODEL = "voyage-context-3"`
- `src/knowledge/embeddings.ts` — `createEmbeddingProvider`, `createContextualizedEmbeddingProvider`, `voyageFetch` helper
- `src/knowledge/embedding-repair.ts` — `NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-code-3"`, repair pipeline for all non-wiki corpora
- `src/knowledge/wiki-embedding-repair.ts` — `TARGET_WIKI_EMBEDDING_MODEL = "voyage-context-3"`, wiki repair pipeline
- `src/knowledge/retrieval.ts` — cross-corpus RRF + source-weight + language-boost pipeline; final `unifiedResults` array is the insertion point for reranker
- `src/knowledge/review-comment-store.ts` — hardcoded `"voyage-code-3"` in 3 places
- `src/knowledge/code-snippet-store.ts` — hardcoded `"voyage-code-3"` in 2 places
- `src/knowledge/wiki-store.ts` — hardcoded `"voyage-code-3"` in 2 places (used as fallback when no model specified)
- Voyage rerank API: `POST https://api.voyageai.com/v1/rerank`, body: `{ query, documents: string[], model, top_k? }`, response: `{ data: [{ index, relevance_score }] }`

## Relevant Requirements

- This milestone does not directly address R001/R002 (token visibility) — orthogonal capability improvement.

## Scope

### In Scope

- Change `DEFAULT_EMBEDDING_MODEL` and `NON_WIKI_TARGET_EMBEDDING_MODEL` to `voyage-4`
- Update all hardcoded `"voyage-code-3"` strings in stores to use the constant or `voyage-4` directly
- Add `createRerankProvider` to `embeddings.ts` (same `voyageFetch` pattern, fail-open)
- Wire reranker as post-RRF step in `retrieval.ts` — reorder `unifiedResults` by relevance_score
- Thread `rerankProvider` through `createRetriever` deps and `createKnowledgeRuntime`
- Update repair pipeline constants
- Tests for reranker (fail-open path, happy path, no-op when provider absent)

### Out of Scope / Non-Goals

- Changing `voyage-context-3` or the contextualized wiki embedding API
- Changing embedding dimensions (stays 1024)
- DB schema migration (not needed — same vector dimensions)
- Batch embedding API
- `rerank-2.5-lite` (use full model for now)
- Instruction-following feature of rerank-2.5

## Technical Constraints

- Reranker must be fail-open: if the API call fails or provider is absent, return RRF-ranked results unchanged
- The reranker receives `unifiedResults` text strings after RRF + source-weight + language-boost, so it sees the already-filtered top-K candidates
- Same `VOYAGE_API_KEY` is reused for the reranker — no new env var needed
- Bun compatibility: use raw `fetch` (no SDK), same pattern as existing `voyageFetch`

## Open Questions

- None — approach is clear from codebase inspection and Voyage docs.
