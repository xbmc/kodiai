# S02 Research: Reranker Pipeline Wiring + Runtime Integration

**Slice:** M035/S02
**Risk:** medium
**Depends on:** S01 (complete)

## Summary

S01 delivered everything S02 needs: `createRerankProvider` is in `embeddings.ts`, `RerankProvider` type is in `types.ts`, all non-wiki constants are `voyage-4`. S02 is a straightforward threading exercise: add `rerankProvider` as an optional dep to `createRetriever`, insert a post-dedup rerank step (6h) in `retrieval.ts`, thread the dep through `createKnowledgeRuntime`, and add tests for the happy path, fail-open, and absent-provider cases.

No API shape unknowns. No new packages. Established pattern throughout.

## Implementation Landscape

### Files to Change

| File | Change |
|------|--------|
| `src/knowledge/retrieval.ts` | Add `rerankProvider?: RerankProvider` to `createRetriever` deps. Insert step 6h after cross-corpus dedup (after line ~806): call `rerankProvider.rerank()`, reorder `unifiedResults`, attach `rerankScore` field. Fail-open: if provider absent or returns null, skip reorder. |
| `src/knowledge/runtime.ts` | Import `createRerankProvider`. Create provider instance in `createKnowledgeRuntime`. Add `rerankProvider` to `KnowledgeRuntime` type. Pass it into `createRetriever` deps. Log `{ model: rerankProvider.model }` at init time. |
| `src/knowledge/cross-corpus-rrf.ts` | Add optional `rerankScore?: number` field to `UnifiedRetrievalChunk` type for downstream transparency. |
| `src/knowledge/retrieval.test.ts` | Add tests: (a) reranker reorders results, (b) fail-open when reranker returns null, (c) absent rerankProvider → unmodified order. |

### Exact Insertion Point in `retrieval.ts`

The reranker step belongs between step 6f (cross-corpus dedup, ~line 805) and the citation tracking + context assembly block (~line 812). Current code flow:

```
// 6f: Cross-corpus dedup
unifiedResults = deduplicateChunks({ chunks: unifiedResults, ... });

// ← INSERT STEP 6g: Neural rerank here
// If rerankProvider present: call rerank(query, unifiedResults.map(c => c.text), topK)
// On non-null result: reorder unifiedResults by returned indices, attach rerankScore
// On null (fail-open): skip — unifiedResults order unchanged

// Citation tracking (currently called 6g, becomes 6h)
const wikiPageIds = ...
```

The reranker receives `unifiedResults.map(c => c.text)` — already the top-K filtered, deduped candidates (typically 5–10 items). The `topK` passed to `rerank()` should equal `unifiedResults.length` (or be omitted) since we already have the right number of candidates.

Reordering: `rerankProvider.rerank()` returns `number[]` — an array of original indices sorted by relevance descending. Use this to reorder `unifiedResults`:
```ts
const texts = unifiedResults.map(c => c.text);
const rankedIndices = await deps.rerankProvider.rerank({ query: intentQuery, documents: texts });
if (rankedIndices !== null) {
  const reranked = rankedIndices.map(i => ({
    ...unifiedResults[i]!,
    rerankScore: rankedIndices.indexOf(i), // or: store actual relevance_score from API
  }));
  unifiedResults = reranked;
}
```

Note: `voyageFetch` already returns the full `VoyageRerankResponse` — but `createRerankProvider` currently maps this to `number[]` (the reranked indices), losing the `relevance_score` values. To attach `rerankScore` to each chunk, there are two options:

**Option A (simpler, current interface):** Attach a descending integer rank as `rerankScore` (rank 0 = highest relevance). No interface change to `RerankProvider`.

**Option B (richer):** Return `{ index: number; relevance_score: number }[]` from `rerank()` and update the `RerankProvider` type. More transparent but requires changing S01-delivered code.

**Recommendation:** Use Option A for S02. The `rerankScore` field is informational metadata; the actual ranking improvement comes from the reordering. If actual scores are needed later, that's a separate enhancement.

### `createKnowledgeRuntime` Threading

Current signature:
```ts
export function createKnowledgeRuntime(opts: {
  sql: Sql;
  logger: Logger;
  voyageApiKey?: string | null;
  retrieverConfig?: RetrieverConfig;
}): KnowledgeRuntime
```

`KnowledgeRuntime` type needs `rerankProvider: RerankProvider` added. The factory should:
1. Call `createRerankProvider({ apiKey: voyageApiKey, logger })` unconditionally — `createRerankProvider` already handles empty `apiKey` by returning a no-op provider with info log.
2. Log `{ model: rerankProvider.model }` with a `"Rerank provider initialized"` message (mirrors existing embedding provider log pattern).
3. Pass `rerankProvider` into `createRetriever` deps.

No new env var needed — reuses `VOYAGE_API_KEY`.

### `UnifiedRetrievalChunk` Type

Add `rerankScore?: number` after `rrfScore` in `cross-corpus-rrf.ts`. This is the only type change needed and is backward-compatible (optional field).

### Test Strategy

Tests live in `src/knowledge/retrieval.test.ts`. The existing test infrastructure already has:
- `makeMockEmbeddingProvider()` — reusable
- `makeMockIsolationLayer(results)` — reusable
- `makeConfig()` — reusable

New tests need a `makeMockRerankProvider()` helper that accepts a result map `(documents: string[]) => number[] | null`. Tests to add (3 minimum):

1. **Reranker reorders results**: Set up 2+ code chunks with distinct ids, mock rerankProvider returning reversed index order, assert `unifiedResults[0].id` matches the chunk that was ranked last by RRF but first by reranker.
2. **Fail-open when reranker returns null**: Mock returns `null`, assert `unifiedResults` is non-empty and order matches RRF order (not crashed).
3. **Absent rerankProvider**: Create retriever without `rerankProvider` dep, assert retrieval still returns results normally (existing behavior unchanged).

Also add a `rerankScore` presence check in the happy path test.

### Provenance

Update `RetrieveResult.provenance` to include `rerankApplied: boolean` — set `true` when reranker returned a non-null result, `false` otherwise. This is low cost and useful for observability.

## Key Constraints

- Reranker must be fail-open: if `rerankProvider` absent or `rerank()` returns `null`, return RRF-ranked results unchanged — no throw, no empty result.
- `intentQuery` (`opts.queries[0]`) is the query string passed to the reranker — consistent with how other search steps use it.
- No new env vars. Same `VOYAGE_API_KEY`.
- No DB migrations. No schema changes.
- Bun fetch mock pattern (from S01): `globalThis.fetch = mock(...) as unknown as typeof globalThis.fetch` — but the new reranker tests in `retrieval.test.ts` don't need to mock fetch since they inject a mock `RerankProvider` directly.

## Task Decomposition (Recommended)

**T01 — Wire reranker into `retrieval.ts` + `cross-corpus-rrf.ts` type**
- Add `rerankScore?: number` to `UnifiedRetrievalChunk`
- Add `rerankProvider?: RerankProvider` to `createRetriever` deps
- Insert step 6g (neural rerank) after cross-corpus dedup
- Update provenance with `rerankApplied`
- Verify: `bun run tsc --noEmit` exits clean

**T02 — Thread `rerankProvider` through `createKnowledgeRuntime`**
- Import `createRerankProvider` in `runtime.ts`
- Add `rerankProvider: RerankProvider` to `KnowledgeRuntime` type
- Create provider instance, log init, pass to `createRetriever`
- Verify: `bun run tsc --noEmit` exits clean; runtime boots with reranker model in logs

**T03 — Tests: reranker ordering, fail-open, absent provider**
- Add 3+ tests to `retrieval.test.ts`
- Verify: `bun test ./src/knowledge/retrieval.test.ts` passes; existing tests unchanged

## Forward Intelligence

- `createRerankProvider` with empty `apiKey` returns a no-op provider that returns `null` from `rerank()`. Threading this through runtime.ts means even in environments without a VOYAGE_API_KEY the reranker is "present" but no-op — the fail-open path in retrieval.ts handles `null` return gracefully.
- `unifiedResults` after step 6f is already sliced to `topK` and deduped — passing it directly to the reranker is correct. Don't pass the pre-slice pool.
- The `intentQuery` variable (`opts.queries[0]!`) is defined at the top of the `retrieve()` function — use it directly as the reranker query.
- `rerankProvider` in `createRetriever` deps is optional (`?`) because some call sites (e.g., test helpers, partial instantiations) don't inject it. The runtime always injects it.
- Existing tests in `retrieval.test.ts` don't inject `rerankProvider` → they exercise the absent-provider path automatically once it's wired. No existing tests should break.
