# S02: Reranker Pipeline Wiring + Runtime Integration

**Goal:** Wire the S01 rerank provider into cross-corpus retrieval and runtime composition so retrieval can apply rerank-2.5 after RRF with fail-open behavior and observable runtime/model state.
**Demo:** After this: After this: retrieval pipeline calls reranker and returns reranked unified results; fail-open test passes; runtime boots with correct model names in logs

## Tasks
- [x] **T01: Wired a fail-open neural rerank step into the unified retrieval pipeline and surfaced rerank metadata in the retrieval types/provenance.** — Add the retrieval-layer contract for reranking: extend `UnifiedRetrievalChunk` with `rerankScore?: number`, extend `createRetriever` deps with `rerankProvider?: RerankProvider`, insert the neural rerank step after cross-corpus dedup and before citation tracking, and surface `rerankApplied` in `RetrieveResult.provenance`.

Steps:
1. Extend the retrieval-facing types: add `rerankScore?: number` to `UnifiedRetrievalChunk` in `src/knowledge/cross-corpus-rrf.ts`, import `RerankProvider` into `src/knowledge/retrieval.ts`, add `rerankProvider?: RerankProvider` to `createRetriever` deps, and add `rerankApplied: boolean` to `RetrieveResult.provenance`.
2. In `retrieve()`, declare `let rerankApplied = false` before the dedup/rerank segment, then insert a new step after cross-corpus dedup that calls `deps.rerankProvider?.rerank({ query: intentQuery, documents: unifiedResults.map(c => c.text) })`.
3. If rerank returns a non-null index array, reorder `unifiedResults` by those indices, attach `rerankScore` using the new rank position, and set `rerankApplied = true`. If the provider is absent, returns `null`, or throws, leave `unifiedResults` unchanged and log a fail-open warning only for the throw path.
4. Thread `rerankApplied` into the returned provenance object and run `bun run tsc --noEmit` to close the type boundary immediately.
  - Estimate: 30m
  - Files: src/knowledge/cross-corpus-rrf.ts, src/knowledge/retrieval.ts, src/knowledge/types.ts
  - Verify: bun run tsc --noEmit
- [x] **T02: Threaded rerank provider through runtime composition and added a focused startup-wiring regression test.** — Wire the S01 provider into `createKnowledgeRuntime`, expose it on the runtime surface, and add a focused runtime test that proves the provider is constructed, surfaced, and logged with the correct model name.

Steps:
1. In `src/knowledge/runtime.ts`, import `createRerankProvider` and `RerankProvider`, construct `const rerankProvider = createRerankProvider({ apiKey: voyageApiKey, logger })` alongside the other providers, and emit `logger.info({ model: rerankProvider.model }, "Rerank provider initialized")`.
2. Add `rerankProvider: RerankProvider` to the `KnowledgeRuntime` type, pass `rerankProvider` into the `createRetriever` deps object, and include it in the returned runtime object.
3. Add `src/knowledge/runtime.test.ts` with a focused runtime-composition test that instantiates `createKnowledgeRuntime` with a stub logger/sql surface, then asserts the returned runtime exposes a rerank provider and that the logger saw the expected rerank model initialization message.
4. Run `bun test ./src/knowledge/runtime.test.ts` and `bun run tsc --noEmit` so the runtime wiring claim is backed by executable proof.
  - Estimate: 35m
  - Files: src/knowledge/runtime.ts, src/knowledge/runtime.test.ts
  - Verify: bun test ./src/knowledge/runtime.test.ts && bun run tsc --noEmit
- [x] **T03: Added retrieval regressions for rerank ordering, null-return fail-open behavior, and absent-provider behavior.** — Extend `src/knowledge/retrieval.test.ts` with a mock rerank provider and regression coverage for the three slice contracts: successful reorder, fail-open null return, and absent-provider behavior.

Steps:
1. Add a local `makeMockRerankProvider()` helper in `src/knowledge/retrieval.test.ts` that implements the `RerankProvider` interface and returns caller-controlled index arrays or `null`.
2. Add a reorder test that builds at least two retrieval candidates, injects a rerank provider that reverses their order, then asserts `unifiedResults` reorder correctly, `rerankScore` is attached by rank position, and `provenance.rerankApplied === true`.
3. Add fail-open tests for (a) provider returns `null` and (b) no provider is injected at all; both must return retrieval results without crashing and must leave `provenance.rerankApplied === false`.
4. Run `bun test ./src/knowledge/retrieval.test.ts` and fix any order-assumption issues by grounding the assertions in the actual pre-rerank RRF output.
  - Estimate: 30m
  - Files: src/knowledge/retrieval.test.ts, src/knowledge/retrieval.ts
  - Verify: bun test ./src/knowledge/retrieval.test.ts
