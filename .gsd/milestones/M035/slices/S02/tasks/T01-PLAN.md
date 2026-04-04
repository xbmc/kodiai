---
estimated_steps: 4
estimated_files: 3
skills_used: []
---

# T01: Insert fail-open neural rerank step in retrieval pipeline

**Slice:** S02 — Reranker Pipeline Wiring + Runtime Integration
**Milestone:** M035

## Description

Add the retrieval-layer contract for reranking. This task extends the unified retrieval types, adds the optional rerank dependency to `createRetriever`, inserts the rerank step immediately after cross-corpus dedup, and records whether reranking actually applied on the returned provenance object.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `rerankProvider.rerank()` | Catch, log `logger.warn({ err }, "Reranker failed (fail-open)")`, and keep the pre-rerank `unifiedResults` order | Treat as the same fail-open error path and keep the pre-rerank order | Ignore the rerank result unless it is a usable index array; keep the pre-rerank order |

## Load Profile

- **Shared resources**: Voyage rerank API quota and the in-memory `unifiedResults` candidate list
- **Per-operation cost**: One rerank call on the already-sliced post-dedup candidate list, typically small (`topK`-sized) compared with the upstream retrieval work
- **10x breakpoint**: External rerank latency/rate limits fail first; fail-open behavior must keep retrieval usable even when the rerank provider is degraded

## Negative Tests

- **Malformed inputs**: Empty candidate list, missing provider, and null rerank result must all preserve the current order without crashing
- **Error paths**: Thrown rerank provider error must emit the fail-open warning and return the current RRF-ranked results
- **Boundary conditions**: Single-result candidate list and reversed two-result list must both produce stable, deterministic output

## Steps

1. Extend `UnifiedRetrievalChunk` in `src/knowledge/cross-corpus-rrf.ts` with `rerankScore?: number` and extend `RetrieveResult.provenance` in `src/knowledge/retrieval.ts` with `rerankApplied: boolean`.
2. Add `rerankProvider?: RerankProvider` to the `createRetriever` dependency surface and declare `let rerankApplied = false` before the dedup/rerank segment inside `retrieve()`.
3. Insert the rerank step after cross-corpus dedup and before citation tracking: call `deps.rerankProvider?.rerank({ query: intentQuery, documents: unifiedResults.map(c => c.text) })`, reorder results by returned indices, and attach `rerankScore` by rank position.
4. Preserve pre-rerank ordering for absent/null/throwing providers, add `rerankApplied` to the returned provenance object, and close the type boundary with `bun run tsc --noEmit`.

## Must-Haves

- [ ] `src/knowledge/retrieval.ts` accepts `rerankProvider?: RerankProvider` without breaking existing call sites
- [ ] The rerank step runs after dedup and before citation tracking
- [ ] Successful rerank reorders `unifiedResults` and annotates each item with `rerankScore`
- [ ] Absent, null, or throwing provider paths leave the RRF-ranked results unchanged
- [ ] `RetrieveResult.provenance` includes `rerankApplied`

## Verification

- `bun run tsc --noEmit`
- Confirm the rerank step is positioned between the `deduplicateChunks(...)` call and wiki citation tracking in `src/knowledge/retrieval.ts`

## Observability Impact

- Signals added/changed: `RetrieveResult.provenance.rerankApplied`, fail-open reranker warning log on thrown provider errors
- How a future agent inspects this: read `RetrieveResult.provenance` in tests/callers and inspect the warning path in `src/knowledge/retrieval.ts`
- Failure state exposed: rerank application becomes explicit per request; thrown provider failures are visible in structured logs

## Inputs

- `src/knowledge/cross-corpus-rrf.ts` — unified chunk type that needs `rerankScore`
- `src/knowledge/retrieval.ts` — retrieval orchestration and provenance surface
- `src/knowledge/types.ts` — source of the `RerankProvider` type already delivered by S01

## Expected Output

- `src/knowledge/cross-corpus-rrf.ts` — `UnifiedRetrievalChunk` exposes optional `rerankScore`
- `src/knowledge/retrieval.ts` — rerank provider dependency, post-dedup rerank step, fail-open handling, and `rerankApplied` provenance
