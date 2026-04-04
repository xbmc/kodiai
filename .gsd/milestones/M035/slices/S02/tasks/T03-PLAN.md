---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test
---

# T03: Add retrieval regression tests for rerank ordering and fail-open behavior

**Slice:** S02 — Reranker Pipeline Wiring + Runtime Integration
**Milestone:** M035

## Description

Extend `src/knowledge/retrieval.test.ts` with a mock rerank provider and regression coverage for the three slice contracts: successful reorder, fail-open null return, and absent-provider behavior. These tests are the slice’s main proof that the retrieval contract changed correctly without requiring a live Voyage API key.

## Steps

1. Add a local `makeMockRerankProvider()` helper in `src/knowledge/retrieval.test.ts` that implements the `RerankProvider` interface and returns caller-controlled index arrays or `null`.
2. Add a reorder test that creates at least two retrieval candidates, injects a rerank provider that reverses their order, then asserts `unifiedResults` reorder correctly, `rerankScore` is assigned by rank position, and `provenance.rerankApplied === true`.
3. Add fail-open tests for the null-return path and the absent-provider path; both must produce retrieval output without crashing and must leave `provenance.rerankApplied === false`.
4. Run `bun test ./src/knowledge/retrieval.test.ts` and adjust assertions to the actual pre-rerank RRF order if needed so the tests lock the real contract instead of a guessed ordering.

## Must-Haves

- [ ] `makeMockRerankProvider()` exists in `src/knowledge/retrieval.test.ts`
- [ ] A successful reorder test proves `unifiedResults` reorder and `rerankScore` is attached
- [ ] A null-return test proves fail-open behavior without a crash
- [ ] An absent-provider test proves the pre-S02 behavior still works

## Verification

- `bun test ./src/knowledge/retrieval.test.ts`
- Confirm the new assertions cover `provenance.rerankApplied` in both success and fail-open paths

## Inputs

- `src/knowledge/retrieval.test.ts` — existing retrieval regression file to extend
- `src/knowledge/retrieval.ts` — implementation contract under test
- `src/knowledge/cross-corpus-rrf.ts` — source of the `rerankScore` field now expected on unified results

## Expected Output

- `src/knowledge/retrieval.test.ts` — regression coverage for reorder, null-return fail-open, and absent-provider behavior
