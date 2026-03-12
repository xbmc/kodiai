---
estimated_steps: 5
estimated_files: 6
---

# T02: Build the shared repair engine, generic state table, and live review-comment path

**Slice:** S03 — Unified Online Repair for Remaining Corpora
**Milestone:** M027

## Description

Implement the reusable non-wiki repair core with durable corpus-scoped progress state, then wire it first to `review_comments`, the only currently degraded remaining corpus, so S03 starts by closing live production risk.

## Steps

1. Create `src/knowledge/embedding-repair.ts` with the shared row-based repair contract, bounded batch loop, resume handling, stable report envelope, and injected corpus-adapter interface.
2. Add `src/db/migrations/029-embedding-repair-state.sql` and `.down.sql` for a generic `embedding_repair_state` table keyed by corpus and repair key, separate from ingestion sync state.
3. Extend `src/knowledge/review-comment-store.ts` / `src/knowledge/review-comment-types.ts` with repair-specific candidate selection, batched updates, and checkpoint persistence helpers needed by the shared engine.
4. Implement the `review_comments` adapter so embeddings are regenerated from stored `chunk_text`, with degraded selection covering null/stale/wrong-model rows and progress checkpoints written after every bounded batch.
5. Make `src/knowledge/embedding-repair.test.ts` pass for the shared engine and the `review_comments` corpus path.

## Must-Haves

- [ ] Repair state persists cursor, counts, last failure metadata, and resume readiness in `embedding_repair_state` instead of `review_comment_sync_state` or logs.
- [ ] The shared engine keeps non-wiki target model routing pinned to `voyage-code-3` and exposes stable `success` / `status_code` / `run` fields.
- [ ] `review_comments` repair is row-local and DB-driven, using persisted `chunk_text` without any GitHub API dependency.

## Verification

- `bun test src/knowledge/embedding-repair.test.ts`
- The shared-engine tests pass for review-comment repair planning, bounded execution, persisted checkpoint updates, and failure-summary reporting.

## Observability Impact

- Signals added/changed: Durable `embedding_repair_state` progress rows plus stable per-run status/failure fields returned by the shared engine.
- How a future agent inspects this: Query `embedding_repair_state` or call the later CLI status mode to inspect last cursor, counts, and failure class for `review_comments`.
- Failure state exposed: Last processed row, last failure class/message, retry count, and resumed-vs-fresh execution become inspectable after process exit.

## Inputs

- `src/knowledge/review-comment-embedding-sweep.ts` — existing batching/delay semantics worth preserving while adding durable state.
- `src/knowledge/review-comment-store.ts` — existing null-embedding repair helpers and schema knowledge for `review_comments`.

## Expected Output

- `src/knowledge/embedding-repair.ts` — reusable shared engine and types for non-wiki corpus repair.
- `src/db/migrations/029-embedding-repair-state.sql` — durable generic repair-state table.
- `src/knowledge/review-comment-store.ts` — repair-specific candidate/update/state helpers supporting live review-comment repair.
