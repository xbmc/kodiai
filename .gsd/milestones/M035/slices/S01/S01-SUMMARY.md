---
id: S01
parent: M035
milestone: M035
provides:
  - createRerankProvider(opts: { apiKey, logger }): RerankProvider — ready for S02 to wire into the cross-corpus retrieval pipeline
  - RerankProvider type in types.ts — S02 can import and use as the type for the reranker dependency
  - voyage-4 is now the universal non-wiki embedding model constant — all stores, config defaults, and audit map are aligned
  - EXPECTED_CORPUS_MODELS in embedding-audit.ts updated to voyage-4 — next audit run will flag existing voyage-code-3 rows as model_mismatch, triggering repair
requires:
  []
affects:
  - S02 — can now import createRerankProvider and RerankProvider; all embedding model constants are voyage-4
key_files:
  - src/knowledge/runtime.ts
  - src/knowledge/embedding-repair.ts
  - src/knowledge/review-comment-store.ts
  - src/knowledge/code-snippet-store.ts
  - src/knowledge/wiki-store.ts
  - src/knowledge/memory-store.ts
  - src/knowledge/review-comment-embedding-sweep.ts
  - src/knowledge/issue-store.ts
  - src/knowledge/embedding-audit.ts
  - src/execution/config.ts
  - src/knowledge/cluster-matcher.ts
  - src/knowledge/types.ts
  - src/knowledge/embeddings.ts
  - src/knowledge/embeddings.test.ts
key_decisions:
  - Kept test files with 'voyage-code-3' unchanged — they hold fixture/historical data representing the old model state, not production model references
  - wiki_pages corpus in EXPECTED_CORPUS_MODELS remains 'voyage-context-3' — uses a different model family (voyage-context-3), not voyage-code-3
  - createRerankProvider uses voyageFetch fail-open pattern with timeoutMs:30000 and maxRetries:1, matching the established embedding provider approach
  - Bun Mock<...> type lacks preconnect vs typeof fetch — cast globalThis.fetch assignments as unknown as typeof globalThis.fetch to satisfy TSC without affecting runtime behavior
patterns_established:
  - createRerankProvider factory in embeddings.ts follows the voyageFetch fail-open pattern: empty apiKey → no-op provider returning null; live provider wraps voyageFetch and returns null on any error or empty response
  - RerankProvider type in types.ts defines the rerank interface: rerank(opts) → Promise<number[] | null> with readonly model getter — null signals fail-open, array of indices signals success
  - Bun fetch mock pattern: globalThis.fetch = mock(...) as unknown as typeof globalThis.fetch per test, restoring afterEach — allows testing voyageFetch-based functions without HTTP
observability_surfaces:
  - createRerankProvider logs info 'Rerank provider disabled -- using no-op provider (no apiKey)' when apiKey is absent
  - Live rerank provider emits logger.warn with { model: 'rerank-2.5' } when API returns non-null but empty data array (degraded but not failed)
drill_down_paths:
  - .gsd/milestones/M035/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M035/slices/S01/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T16:07:50.976Z
blocker_discovered: false
---

# S01: voyage-4 Embedding Upgrade + Reranker Client

**Upgraded all non-wiki embedding constants to voyage-4, swept 25 hardcoded voyage-code-3 literals from 11 source files, and implemented createRerankProvider with RerankProvider type and 9 passing unit tests.**

## What Happened

## T01: voyage-code-3 → voyage-4 Sweep

Changed `DEFAULT_EMBEDDING_MODEL` in `src/knowledge/runtime.ts` and `NON_WIKI_TARGET_EMBEDDING_MODEL` in `src/knowledge/embedding-repair.ts` to `"voyage-4"`. Swept all 25 remaining hardcoded `"voyage-code-3"` literals from 11 non-test source files:

- `review-comment-store.ts` (4 hits): embeddingModel assignments and `IS DISTINCT FROM` SQL clauses
- `code-snippet-store.ts` (2 hits): same pattern
- `wiki-store.ts` (2 hits): fallback default values
- `memory-store.ts` (3 hits): literal model strings
- `review-comment-embedding-sweep.ts` (1 hit): local `EMBEDDING_MODEL` constant
- `issue-store.ts` (5 hits): multiple query and insertion sites
- `embedding-audit.ts` (5 hits): `EXPECTED_CORPUS_MODELS` map — all five non-wiki corpora (learning_memories, review_comments, code_snippets, issues, issue_comments) updated; `wiki_pages` was intentionally left as `"voyage-context-3"` (different model family)
- `config.ts` (3 hits): Zod schema defaults
- `cluster-matcher.ts` (1 hit): JSDoc comment only

Test files were left with `"voyage-code-3"` — they hold fixture/historical data and intentionally represent the old model state. After the sweep, `grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts'` returns exactly 0 hits.

## T02: RerankProvider Type + createRerankProvider Factory

Added `RerankProvider` type to `src/knowledge/types.ts` immediately after `EmbeddingProvider`:
```ts
export type RerankProvider = {
  rerank(opts: { query: string; documents: string[]; topK?: number }): Promise<number[] | null>;
  readonly model: string;
};
```

Implemented `createRerankProvider` in `src/knowledge/embeddings.ts` following the established `voyageFetch` fail-open pattern:
- `VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank"` constant added
- `VoyageRerankResponse` interface added
- No-op provider returned when `apiKey` is empty — logs info and returns `null` from `rerank()`
- Live provider wraps `voyageFetch` with `timeoutMs: 30_000, maxRetries: 1`
- Fail-open on null response (network/auth failure) — returns `null`
- Fail-open on empty/missing `data` array — emits `logger.warn` with model field, returns `null`
- Happy path: returns `response.data.map(item => item.index)` (the reranked indices)
- `model` getter always returns `"rerank-2.5"`

Created `src/knowledge/embeddings.test.ts` with 9 unit tests using Bun's built-in test runner. Tests mock `globalThis.fetch` per-test. Notable: Bun's `Mock<...>` type lacks `preconnect` vs `typeof fetch` — assignments cast as `unknown as typeof globalThis.fetch` to satisfy TSC without runtime impact. An extra test (`does not include top_k when topK is undefined`) was added beyond the 7 planned to cover the complementary path.

## Verification

1. `grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts' | grep -c '' || true` → printed `0` ✅
2. `bun test ./src/knowledge/embeddings.test.ts` → 9/9 pass ✅
3. `bun run tsc --noEmit` → clean exit, no errors ✅

## Requirements Advanced

- R030 — All non-wiki corpora constants updated to voyage-4; createRerankProvider with rerank-2.5 model implemented and unit-tested

## Requirements Validated

- R030 — grep returns 0 non-test voyage-code-3 hits; 9 createRerankProvider unit tests pass; tsc --noEmit exits clean

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T02 added one extra test (does not include top_k when topK is undefined) beyond the 7 specified in the plan — trivial addition covering the complementary path. All other work matched the plan exactly.

## Known Limitations

Existing DB rows still store `embedding_model = 'voyage-code-3'`. This is expected and intentional — the repair sweep (S02 or a future ops runbook step) will migrate them. The updated `EXPECTED_CORPUS_MODELS` map in `embedding-audit.ts` correctly flags these rows as `model_mismatch` on the next audit run, which triggers the repair pipeline.

## Follow-ups

S02 must wire `createRerankProvider` into the cross-corpus retrieval pipeline as a post-RRF neural reranking step. S02 also needs to ensure runtime boots with the correct model names logged for both embedding and rerank models.

## Files Created/Modified

- `src/knowledge/runtime.ts` — DEFAULT_EMBEDDING_MODEL changed to voyage-4
- `src/knowledge/embedding-repair.ts` — NON_WIKI_TARGET_EMBEDDING_MODEL changed to voyage-4
- `src/knowledge/review-comment-store.ts` — 4 voyage-code-3 literals replaced with voyage-4
- `src/knowledge/code-snippet-store.ts` — 2 voyage-code-3 literals replaced with voyage-4
- `src/knowledge/wiki-store.ts` — 2 voyage-code-3 fallback defaults replaced with voyage-4
- `src/knowledge/memory-store.ts` — 3 voyage-code-3 literals replaced with voyage-4
- `src/knowledge/review-comment-embedding-sweep.ts` — EMBEDDING_MODEL constant changed to voyage-4
- `src/knowledge/issue-store.ts` — 5 voyage-code-3 literals replaced with voyage-4
- `src/knowledge/embedding-audit.ts` — EXPECTED_CORPUS_MODELS updated: 5 non-wiki corpora now expect voyage-4
- `src/execution/config.ts` — 3 Zod schema defaults updated to voyage-4
- `src/knowledge/cluster-matcher.ts` — JSDoc comment updated to voyage-4
- `src/knowledge/types.ts` — RerankProvider type added after EmbeddingProvider
- `src/knowledge/embeddings.ts` — VOYAGE_RERANK_URL constant, VoyageRerankResponse interface, and createRerankProvider factory added
- `src/knowledge/embeddings.test.ts` — New file: 9 unit tests for createRerankProvider using Bun test runner
