# S01 Research: voyage-4 Embedding Upgrade + Reranker Client

## Summary

This is light-to-targeted research. The work is straightforward: update model string constants and hardcoded literals, add one new provider function to an existing provider file, and define a type. All patterns are already established in `embeddings.ts`. No new APIs, no schema changes, no migration needed.

The context file was accurate but **understated the scope of hardcoded `"voyage-code-3"` strings**: there are 14 non-test source files with hardcoded strings, not the 3 mentioned. The planner needs the full list.

---

## Recommendation

Two tasks:

1. **T01 — Model constant updates + hardcoded string sweepup**: Change `DEFAULT_EMBEDDING_MODEL` and `NON_WIKI_TARGET_EMBEDDING_MODEL` to `"voyage-4"`, then fix every remaining hardcoded `"voyage-code-3"` string in non-test source to use the constant or `"voyage-4"` directly. Also update `config.ts` schema defaults and `embedding-audit.ts` expected models. Verify with `grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts'` returning zero hits.

2. **T02 — `createRerankProvider` + type definition**: Add the `RerankProvider` type to `types.ts`, implement `createRerankProvider` in `embeddings.ts` following the exact `voyageFetch` pattern, and add unit tests (happy path, fail-open on API error, fail-open on missing apiKey). No wiring into retrieval — that's S02.

---

## Implementation Landscape

### Files to modify in T01 (full list of `"voyage-code-3"` non-test sources)

| File | Location | Change |
|---|---|---|
| `src/knowledge/runtime.ts:18` | `DEFAULT_EMBEDDING_MODEL = "voyage-code-3"` | → `"voyage-4"` |
| `src/knowledge/embedding-repair.ts:145` | `NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-code-3"` | → `"voyage-4"` |
| `src/knowledge/review-comment-store.ts:171,226` | `"voyage-code-3"` literals in embeddingModel | Use `NON_WIKI_TARGET_EMBEDDING_MODEL` from repair module or direct string |
| `src/knowledge/review-comment-store.ts:412,448` | tagged-template SQL + checkpoint default | `"voyage-4"` |
| `src/knowledge/code-snippet-store.ts:274,318` | same pattern as review-comment-store | `"voyage-4"` |
| `src/knowledge/wiki-store.ts:114,158` | fallback `"voyage-code-3"` for embeddingModel opts | Keep as-is — wiki store already uses `DEFAULT_WIKI_EMBEDDING_MODEL` for the embeddingModel param in runtime.ts; the `"voyage-code-3"` fallback here is a defensive default on chunk upserts. Change to `"voyage-4"` to match non-wiki reality. |
| `src/knowledge/memory-store.ts:79,292,338` | row default + stale query + checkpoint default | `"voyage-4"` |
| `src/knowledge/review-comment-embedding-sweep.ts:5` | `const EMBEDDING_MODEL = "voyage-code-3"` | → `"voyage-4"` or use the exported constant |
| `src/knowledge/issue-store.ts:188,345,416,436,479` | embeddingModel fallback + SQL staleness queries + checkpoint default | `"voyage-4"` |
| `src/knowledge/embedding-audit.ts:20-25` | `EXPECTED_CORPUS_MODELS` mapping (non-wiki corpora all `"voyage-code-3"`) | → `"voyage-4"` for `learning_memories`, `review_comments`, `code_snippets`, `issues`, `issue_comments` |
| `src/execution/config.ts:244,247,327` | Zod schema defaults for embeddings config | → `"voyage-4"` |
| `src/knowledge/cluster-matcher.ts:36` | JSDoc comment only — `"voyage-code-3"` | Update comment text |

**Note:** `src/knowledge/retrieval-rerank.test.ts:1` has a `"voyage-code-3"` string in a test fixture (`embeddingModel: "voyage-code-3"`). The planner should decide whether to update it — it's a test fixture for the legacy language-reranker, not the model upgrade. Safe to leave as-is or update to `"voyage-4"`.

### Files to create/modify in T02

| File | Action |
|---|---|
| `src/knowledge/types.ts` | Add `RerankProvider` type (after line ~359) |
| `src/knowledge/embeddings.ts` | Add `VOYAGE_RERANK_URL`, `VoyageRerankResponse` interface, `createRerankProvider` factory function |
| `src/knowledge/embeddings.test.ts` | **New file** — unit tests for `createRerankProvider` (happy path, fail-open on 500, fail-open on null apiKey, fail-open on network error, response with reordered indices) |

### `RerankProvider` type shape

```ts
export type RerankProvider = {
  rerank(opts: { query: string; documents: string[]; topK?: number }): Promise<number[] | null>;
  readonly model: string;
};
```

Returns an ordered array of document indices (by relevance descending), or `null` on failure (caller treats null as fail-open — return original order).

### `createRerankProvider` implementation notes

- URL: `https://api.voyageai.com/v1/rerank`
- Request body: `{ query, documents, model, top_k? }`
- Response: `{ data: [{ index: number; relevance_score: number }] }` — sorted by `relevance_score` desc
- Reuse `voyageFetch<VoyageRerankResponse>` (add a new response interface)
- If `!apiKey`: return a no-op provider with `rerank()` returning `null`
- If `voyageFetch` returns null: return `null` (fail-open)
- If `response.data` missing/empty: return `null` (fail-open)
- On success: return `response.data.map(item => item.index)` (indices sorted by relevance_score desc, which is how the API returns them)
- `model` getter returns `"rerank-2.5"`
- Timeout: 30_000ms, maxRetries: 1 (reranker latency is interactive — don't retry too many times)

### Insertion point in retrieval.ts (S02 work, documented here for planner clarity)

After dedup (line ~806), before citation tracking (line ~812):
```
// 6g-pre: Neural reranker (fail-open)
if (deps.rerankProvider && unifiedResults.length > 1) {
  const indices = await deps.rerankProvider.rerank({
    query: intentQuery,
    documents: unifiedResults.map(c => c.text),
    topK: unifiedResults.length,
  });
  if (indices !== null) {
    const reranked = indices.map(i => unifiedResults[i]).filter(Boolean);
    if (reranked.length === unifiedResults.length) {
      unifiedResults = reranked as UnifiedRetrievalChunk[];
    }
    // else: partial/malformed response — keep original order (fail-open)
  }
}
```

The `RerankProvider` parameter on `createRetriever` deps and `createKnowledgeRuntime` opts are S02 changes.

### Verify commands

**T01 verification:**
```bash
# Must return zero hits
grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '\.test\.ts'
# Run tests to confirm nothing broke
bun test src/knowledge/ --timeout 30000 2>&1 | tail -20
```

**T02 verification:**
```bash
bun test src/knowledge/embeddings.test.ts
bun run tsc --noEmit 2>&1 | tail -20
```

---

## Key Constraints

1. **`voyage-context-3` is untouched** — wiki embedding path (`createContextualizedEmbeddingProvider`, `DEFAULT_WIKI_EMBEDDING_MODEL`, `wiki-embedding-repair.ts`) must not change.
2. **No schema migration** — voyage-4 uses the same 1024 dimensions as voyage-code-3. All existing stale embeddings will be picked up by the repair sweep.
3. **`embedding-audit.ts` `EXPECTED_CORPUS_MODELS`** — this is the canonical expected-model map used by the audit harness. Updating it to `"voyage-4"` for non-wiki corpora is correct and required, but it will cause all existing DB rows (still on `voyage-code-3`) to show as `model_mismatch` in the next audit run. This is expected — the repair sweep will fix them. Document this in the T01 summary.
4. **`config.ts` Zod schema defaults** — the `embeddings.model` field in `AppConfig` defaults to `"voyage-code-3"`. Update to `"voyage-4"`. Any deployed instances with explicit `embeddings.model: "voyage-code-3"` in their config will continue to use that value (Zod doesn't override explicit values). The default change only affects new deployments without explicit embedding config.
5. **`cluster-matcher.ts:36`** — JSDoc comment only, no runtime impact. Update for documentation accuracy.
6. **Test files** — the scope says grep for `voyage-code-3` in non-test source must return zero hits. Test files can retain `"voyage-code-3"` in fixtures. Don't mass-update test files unless they break.
