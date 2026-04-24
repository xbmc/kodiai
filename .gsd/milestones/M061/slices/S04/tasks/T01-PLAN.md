---
estimated_steps: 50
estimated_files: 5
skills_used: []
---

# T01: Add request-scoped query-embedding reuse in the retriever

---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - verify-before-complete
---

# T01: Add request-scoped query-embedding reuse in the retriever

**Slice:** S04 — Retrieval Reuse and Safe Derived-Context Caching
**Milestone:** M061

## Description

Remove duplicate embedding generation inside one `createRetriever().retrieve()` call. Reuse the existing normalized retrieval-variant shape instead of inventing a second normalization path, and keep all corpus searches fail-open.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `EmbeddingProvider.generate()` | log fail-open and continue with empty/partial retrieval results rather than crashing the whole review/mention flow | preserve existing retrieval timeout/failure behavior; no retry loop in this slice | treat `null` or unusable embeddings as a miss and skip that variant/corpus |
| `IsolationLayer.retrieveWithIsolation()` and corpus search helpers | preserve per-search fail-open warnings and continue with other corpora | keep request-scoped memoization in-memory only so hung downstream work does not poison later requests | do not cache malformed embeddings/results; recompute or skip |

## Load Profile

- **Shared resources**: embedding provider rate budget and per-request memory for the short-lived embedding map.
- **Per-operation cost**: one embedding per unique normalized query/provider pair instead of one embedding per repeated corpus/query path.
- **10x breakpoint**: duplicate embedding calls and provider latency should shrink first; memory growth stays bounded by the small variant/corpus fan-out in one request.

## Negative Tests

- **Malformed inputs**: duplicate queries with whitespace/casing variation, repeated identical single-query calls, and empty query arrays.
- **Error paths**: embedding provider throws/nulls for one or all queries while retrieval still returns partial or empty fail-open results.
- **Boundary conditions**: repeated normalized variant strings across intent/file-path/code-shape paths should reuse exactly once per request.

## Steps

1. Add a request-scoped embedding helper in `src/knowledge/retrieval.ts` keyed by normalized query text, input type, and provider/model identity; route learning-memory and corpus vector searches through it.
2. Reuse existing multi-query normalization outputs where possible and dedupe repeated normalized query strings without changing caller-visible ordering.
3. Extend provenance or helper-return metadata so tests can prove reuse happened without inventing a separate reporting subsystem.
4. Add focused regression tests for call counts, duplicate normalized variants, and fail-open cache-bookkeeping faults.

## Must-Haves

- [ ] One retrieval run performs at most one embedding request per unique normalized query/provider/input-type pair.
- [ ] Existing retrieval ordering, fail-open semantics, and unified-results behavior remain unchanged apart from reduced duplicate embedding work.

## Verification

- `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`
- Assert embedding-provider invocation counts directly in regression tests.

## Observability Impact

- Signals added/changed: retriever provenance or internal helper state can prove embedding reuse vs recompute.
- How a future agent inspects this: focused retrieval tests and any provenance fields returned by `retrieve()`.
- Failure state exposed: duplicate-embedding regressions show up as call-count failures rather than silent prompt-cost drift.

## Inputs

- `src/knowledge/retrieval.ts` — primary retrieval seam where duplicate embeddings are currently generated
- `src/knowledge/multi-query-retrieval.ts` — canonical normalized variant builder to reuse instead of re-deriving keys
- `src/knowledge/retrieval.test.ts` — focused unit coverage for retriever behavior
- `src/knowledge/retrieval.e2e.test.ts` — broader regression coverage for multi-corpus retrieval behavior

## Expected Output

- `src/knowledge/retrieval.ts` — request-scoped embedding memoization and truthful provenance
- `src/knowledge/retrieval.test.ts` — embedding reuse and fail-open regression tests
- `src/knowledge/retrieval.e2e.test.ts` — integration-level reuse coverage where needed
- `src/knowledge/multi-query-retrieval.test.ts` — normalization/dedup expectations if helper reuse changes the boundary

## Inputs

- ``src/knowledge/retrieval.ts``
- ``src/knowledge/multi-query-retrieval.ts``
- ``src/knowledge/retrieval.test.ts``
- ``src/knowledge/retrieval.e2e.test.ts``

## Expected Output

- ``src/knowledge/retrieval.ts``
- ``src/knowledge/retrieval.test.ts``
- ``src/knowledge/retrieval.e2e.test.ts``
- ``src/knowledge/multi-query-retrieval.test.ts``

## Verification

bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts

## Observability Impact

Retrieval provenance and tests should make duplicate-embedding regressions explicit instead of silently increasing provider work.
