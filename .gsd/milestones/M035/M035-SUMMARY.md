---
id: M035
title: "Voyage AI Model Upgrades — voyage-4 + rerank-2.5"
status: complete
completed_at: 2026-04-04T16:44:09.987Z
key_decisions:
  - Treat reranker output indices as untrusted and preserve pre-rerank ordering unless the provider returns a full valid permutation of the current candidate set.
  - Construct the rerank provider unconditionally in `createKnowledgeRuntime`; rely on the existing no-op/no-key behavior for fail-open runtime composition.
  - Use baseline-vs-reranked regression assertions so retrieval-order tests lock the actual pre-rerank contract instead of an assumed fixture order.
key_files:
  - src/knowledge/embeddings.ts
  - src/knowledge/types.ts
  - src/knowledge/cross-corpus-rrf.ts
  - src/knowledge/retrieval.ts
  - src/knowledge/runtime.ts
  - src/knowledge/embeddings.test.ts
  - src/knowledge/runtime.test.ts
  - src/knowledge/retrieval.test.ts
lessons_learned:
  - For small but edit-sensitive files, a full rewrite is safer than repeated exact-replace attempts once duplicate-tail artifacts appear.
  - External rerank output should be treated as untrusted even when it comes from an internal provider abstraction; validating index sets keeps fail-open behavior honest.
  - A narrow runtime composition test pays off quickly when a slice claims startup observability or wiring changes.
---

# M035: Voyage AI Model Upgrades — voyage-4 + rerank-2.5

**Completed the voyage-4 + rerank-2.5 upgrade by wiring the reranker into runtime and retrieval, preserving fail-open behavior, and proving the full contract with tests and a clean type gate.**

## What Happened

M035 delivered the full Voyage AI upgrade path in two slices. S01 swept non-wiki embedding usage from `voyage-code-3` to `voyage-4`, added the `RerankProvider` type, and implemented `createRerankProvider()` with fail-open semantics. S02 completed the integration by wiring the provider into `createKnowledgeRuntime()` and `createRetriever()`, inserting a post-dedup neural rerank step into the unified retrieval pipeline, surfacing `rerankApplied` and `rerankScore` metadata, and adding regression coverage for runtime wiring and retrieval behavior. Final milestone verification passed from the same working tree with runtime tests, retrieval tests, and `tsc --noEmit` all green. The result is an end-to-end retrieval stack that uses voyage-4 for non-wiki embeddings and rerank-2.5 for final ranking while preserving fail-open behavior throughout.

## Success Criteria Results

- **Upgrade non-wiki embeddings from voyage-code-3 to voyage-4.** Met. S01 replaced the relevant production references and validated the sweep with a non-test grep plus passing unit/type checks.
- **Add rerank-2.5 at the end of the cross-corpus retrieval pipeline.** Met. S02 inserted the rerank step after cross-corpus dedup and before citation tracking in `src/knowledge/retrieval.ts`.
- **Improve retrieval quality while keeping fail-open semantics throughout.** Met. The provider factory remains fail-open, runtime composes the no-op provider when the key is absent, and retrieval preserves the existing RRF-ranked results when reranking is absent, null, malformed, or throws.
- **Expose observable runtime/model state.** Met. `createKnowledgeRuntime()` logs the rerank model at startup and the retrieval result provenance now reports whether reranking applied.

## Definition of Done Results

- [x] **S01 complete.** Recorded and verified in its slice summary.
- [x] **S02 complete.** Recorded and verified in its slice summary.
- [x] **Final verification passes from milestone final state.** `bun test ./src/knowledge/runtime.test.ts && bun test ./src/knowledge/retrieval.test.ts && bun run tsc --noEmit` exits clean.
- [x] **No unresolved roadmap work remains.** Roadmap reassessment recorded `roadmap-confirmed` with no added/modified/removed slices.
- [x] **Requirement closure is documented.** R030 is fully covered by S01 + S02 and milestone validation recorded a pass verdict.

## Requirement Outcomes

- **R030 — validated / fully delivered.**
  - **Embedding model upgrade proof (S01):** non-test source grep returns zero `voyage-code-3` hits; the non-wiki embedding constants and store defaults now use `voyage-4`.
  - **Rerank provider proof (S01):** `createRerankProvider()` exists in `src/knowledge/embeddings.ts` and its dedicated unit tests pass.
  - **Pipeline integration proof (S02):** `createRetriever()` now performs a post-RRF rerank step, `createKnowledgeRuntime()` composes and logs the rerank provider, retrieval tests prove reorder and fail-open behavior, and `bun run tsc --noEmit` exits clean.
  - **Final verdict:** requirement satisfied end-to-end.

## Deviations

Implementation work hit two transient editing artifacts: duplicate trailing content in `retrieval.ts` and `runtime.ts` during exact-replace retries. Both were cleaned before final verification. No roadmap or scope deviations were required.

## Follow-ups

None.
