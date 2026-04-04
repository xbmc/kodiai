---
id: S02
parent: M035
milestone: M035
provides:
  - Unified retrieval now supports post-RRF neural reranking with fail-open behavior.
  - Runtime startup exposes the configured rerank model in logs and on the `KnowledgeRuntime` surface.
  - Regression tests now guard both retrieval-layer rerank behavior and runtime provider wiring.
requires:
  - slice: S01
    provides: `createRerankProvider()` factory and `RerankProvider` type delivered in S01
affects:
  []
key_files:
  - src/knowledge/cross-corpus-rrf.ts
  - src/knowledge/retrieval.ts
  - src/knowledge/runtime.ts
  - src/knowledge/runtime.test.ts
  - src/knowledge/retrieval.test.ts
key_decisions:
  - Treat reranker output indices as untrusted and preserve pre-rerank ordering unless the provider returns a full valid permutation of the current candidate set.
  - Construct the rerank provider unconditionally in `createKnowledgeRuntime`; the existing no-op provider path is the correct fail-open behavior when `VOYAGE_API_KEY` is absent.
  - Use baseline-vs-reranked assertions in retrieval tests so the contract is grounded in actual pre-rerank RRF output instead of a guessed ordering.
patterns_established:
  - Post-dedup neural rerank pattern: rerank only the already-sliced, deduped unified candidate set rather than the larger upstream retrieval pool.
  - Untrusted-index fail-open guard: external rerank output must be validated against the in-memory candidate set before reordering results.
  - Baseline-vs-reranked regression pattern: compare reranked output to captured pre-rerank RRF output instead of assuming fixture order.
observability_surfaces:
  - `logger.info({ model: rerankProvider.model }, "Rerank provider initialized")` at runtime startup
  - `RetrieveResult.provenance.rerankApplied` per request
  - `logger.warn({ err }, "Reranker failed (fail-open)")` and malformed-index warning path in retrieval
drill_down_paths:
  - .gsd/milestones/M035/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M035/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M035/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T16:43:03.329Z
blocker_discovered: false
---

# S02: Reranker Pipeline Wiring + Runtime Integration

**Integrated rerank-2.5 into the unified retrieval pipeline and runtime composition with fail-open safeguards and regression coverage.**

## What Happened

S02 completed the rerank-2.5 integration that S01 set up. In the retrieval layer, `UnifiedRetrievalChunk` now carries optional `rerankScore`, `createRetriever` accepts an optional `rerankProvider`, and the unified retrieval pipeline executes a new neural rerank step immediately after cross-corpus dedup and before citation tracking. Successful reranks reorder `unifiedResults` and set `provenance.rerankApplied = true`; degraded cases stay fail-open — absent provider, null return, thrown error, or malformed index output all preserve the existing RRF-ranked results. In runtime composition, `createKnowledgeRuntime` now constructs the rerank provider, logs its model at startup, passes it into `createRetriever`, and exposes it on the returned `KnowledgeRuntime` surface. Regression coverage was added at both boundaries: a new `runtime.test.ts` proves provider exposure and startup logging, while `retrieval.test.ts` now proves reorder behavior, null-return fail-open behavior, and absent-provider behavior. Final slice verification succeeded from the same working tree with runtime test, retrieval test, and `tsc --noEmit` all passing.

## Verification

`bun test ./src/knowledge/runtime.test.ts && bun test ./src/knowledge/retrieval.test.ts && bun run tsc --noEmit` passed from final state.

## Requirements Advanced

- R030 — Completed the second half of the requirement by wiring rerank-2.5 into `createRetriever` and `createKnowledgeRuntime`, so the retrieval pipeline now performs a real post-RRF rerank step rather than only exposing the provider factory.

## Requirements Validated

- R030 — `bun test ./src/knowledge/runtime.test.ts && bun test ./src/knowledge/retrieval.test.ts && bun run tsc --noEmit` passes; retrieval tests prove reorder/null/absent-provider behavior and runtime test proves the rerank provider is composed and logged.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T01 and T02 both hit duplicate-tail artifacts during exact-replace edit retries; `retrieval.ts` was cleaned surgically and `runtime.ts` was rewritten cleanly in one pass. T03 also needed one final import fix after the combined verification gate surfaced a dropped `RerankProvider` type import in `retrieval.test.ts`.

## Known Limitations

Live Voyage API behavior is still exercised only when `VOYAGE_API_KEY` is present at runtime; the slice proves the wiring and fail-open semantics with mock providers rather than a live external call. That is intentional and sufficient for this milestone.

## Follow-ups

None.

## Files Created/Modified

- `src/knowledge/cross-corpus-rrf.ts` — Added optional `rerankScore` metadata to unified retrieval chunks so reranked output can carry rank-position provenance.
- `src/knowledge/retrieval.ts` — Extended the retriever dependency surface with `rerankProvider`, inserted the post-dedup rerank step, added malformed-index fail-open handling, and exposed `provenance.rerankApplied`.
- `src/knowledge/runtime.ts` — Threaded `rerankProvider` through runtime composition, exposed it on `KnowledgeRuntime`, and logged the rerank model at startup.
- `src/knowledge/runtime.test.ts` — Added a focused runtime composition regression test proving rerank provider exposure and startup model logging.
- `src/knowledge/retrieval.test.ts` — Added retrieval regressions for rerank ordering, null-return fail-open behavior, and absent-provider behavior.
