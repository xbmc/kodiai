---
id: T01
parent: S02
milestone: M035
key_files:
  - src/knowledge/cross-corpus-rrf.ts
  - src/knowledge/retrieval.ts
key_decisions:
  - Treat reranker output indices as untrusted and preserve the pre-rerank ordering unless the provider returns a full valid permutation of the current candidate set.
  - Expose rerank application state via `RetrieveResult.provenance.rerankApplied` rather than inferring it from result shape.
duration: 
verification_result: passed
completed_at: 2026-04-04T16:35:19.016Z
blocker_discovered: false
---

# T01: Wired a fail-open neural rerank step into the unified retrieval pipeline and surfaced rerank metadata in the retrieval types/provenance.

**Wired a fail-open neural rerank step into the unified retrieval pipeline and surfaced rerank metadata in the retrieval types/provenance.**

## What Happened

Updated `src/knowledge/cross-corpus-rrf.ts` so `UnifiedRetrievalChunk` can carry an optional `rerankScore`, then extended `src/knowledge/retrieval.ts` to import `RerankProvider`, accept an optional `rerankProvider` dependency on `createRetriever`, and expose `rerankApplied` on `RetrieveResult.provenance`. Inserted a new rerank phase immediately after cross-corpus dedup and before wiki citation tracking. The implementation calls `deps.rerankProvider.rerank()` with `intentQuery` and the current candidate texts, reorders `unifiedResults` by returned indices, annotates rank position via `rerankScore`, and fails open when the provider is absent, returns `null`, throws, or returns malformed indices. While landing the change, an edit retry left duplicated tail content in `retrieval.ts`; this was cleaned up before the final type gate run.

## Verification

`bun run tsc --noEmit` exits clean after the retrieval/type changes. The live file now places the rerank step between cross-corpus dedup and citation tracking, and the returned provenance includes `rerankApplied`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun run tsc --noEmit` | 0 | ✅ pass | 6500ms |

## Deviations

Added a malformed-index guard and warning path for reranker output instead of trusting the returned index array blindly. This preserves fail-open behavior if the provider returns partial or invalid indices.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/retrieval.ts`
