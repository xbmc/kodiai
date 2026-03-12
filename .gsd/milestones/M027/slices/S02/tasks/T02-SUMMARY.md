---
id: T02
parent: S02
milestone: M027
provides:
  - Reusable bounded wiki repair engine with hierarchical split fallback, retry-aware window execution, and durable checkpoint persistence primitives.
key_files:
  - src/knowledge/wiki-embedding-repair.ts
  - src/knowledge/wiki-store.ts
  - src/knowledge/embeddings.ts
  - src/db/migrations/028-wiki-embedding-repair-state.sql
key_decisions:
  - Persist wiki repair progress in a dedicated wiki_embedding_repair_state table instead of wiki_sync_state.
  - Batch bounded repair writes with a single UPDATE ... FROM UNNEST(...) unit per window.
patterns_established:
  - Normalize store rows/checkpoints so the repair engine can consume both contract-test snake_case payloads and runtime camelCase store records.
  - Treat size pressure as split-worthy and transient timeout/network/provider failures as retry-worthy without collapsing both into empty-result handling.
observability_surfaces:
  - wiki_embedding_repair_state persisted checkpoint rows with cursor, counts, retry metadata, and last failure class/message
  - runWikiEmbeddingRepair() structured result/progress objects
  - contextualizedEmbedChunksForRepair() classified failure surface
duration: 1h
verification_result: passed
completed_at: 2026-03-11T15:38:00-07:00
blocker_discovered: false
---

# T02: Implement bounded wiki repair engine and durable checkpoint state

**Shipped a bounded wiki repair engine, dedicated repair-state persistence, and classified embedding failure handling for resumable wiki-only repairs.**

## What Happened

Implemented `src/knowledge/wiki-embedding-repair.ts` with the S02 engine contract: degraded-row planning, conservative window splitting, hierarchical split fallback, transient retry handling, per-window batched writes, and checkpoint advancement after each bounded unit.

Extended the wiki store surface with repair-specific helpers and added migration `028-wiki-embedding-repair-state.sql` for a dedicated `wiki_embedding_repair_state` table that persists cursor state, counts, retry metadata, split-fallback usage, and last failure details separately from `wiki_sync_state`.

Extended `src/knowledge/embeddings.ts` with a repair-oriented contextual embedding wrapper that classifies request-too-large vs timeout/rate-limit/server/network failures so later CLI/runtime wiring can make retry vs split decisions from structured failure classes instead of empty maps.

Also normalized repair-engine inputs so the new engine can work with both the snake_case contract fixtures in the S02 tests and the camelCase records returned by the real wiki store.

## Verification

Passed:
- `bun test src/knowledge/wiki-embedding-repair.test.ts`
- `bun test ./src/knowledge/wiki-embedding-repair.test.ts ./src/knowledge/wiki-store.test.ts`
- `bun test ./src/knowledge/wiki-embedding-repair.test.ts ./scripts/wiki-embedding-repair.test.ts ./scripts/verify-m027-s02.test.ts` (T02 engine tests passed; CLI/proof-harness tests still fail as expected because T03/T04 modules are not implemented yet)

Slice-level checks currently failing/pending outside T02 scope:
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json` → script not added yet
- `bun run repair:wiki-embeddings -- --status --json` → script not added yet
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json` → script not added yet
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json` → verifier script not added yet

## Diagnostics

Future agents can inspect:
- `src/knowledge/wiki-embedding-repair.ts` for bounded plan building, retry/split routing, checkpoint writes, and normalized cursor semantics.
- `wiki_embedding_repair_state` rows for `page_id`, `page_title`, `window_index`, `windows_total`, cumulative counts, retry count, split-fallback usage, and last failure class/message.
- `contextualizedEmbedChunksForRepair()` in `src/knowledge/embeddings.ts` for the stable failure-class surface that distinguishes size pressure from transient provider failures.

## Deviations

None.

## Known Issues

- T03/T04 operator surfaces are still missing, so slice-level CLI/proof verification remains red until those modules and package scripts are added.
- No dedicated `wiki-store` repair-helper tests were added in this task; existing store regression coverage passed after the migration and store changes.

## Files Created/Modified

- `src/knowledge/wiki-embedding-repair.ts` — added bounded wiki repair planner/executor with retry-vs-split routing and progress reporting.
- `src/knowledge/wiki-store.ts` — added degraded-row listing, dedicated repair checkpoint persistence, and per-window batch embedding updates.
- `src/knowledge/wiki-types.ts` — extended wiki store contract with repair checkpoint and batched repair-write types.
- `src/knowledge/embeddings.ts` — added repair-oriented contextual embedding classification wrapper and failure classes.
- `src/db/migrations/028-wiki-embedding-repair-state.sql` — created dedicated repair checkpoint table.
- `src/db/migrations/028-wiki-embedding-repair-state.down.sql` — added rollback for the repair checkpoint table.
- `.gsd/DECISIONS.md` — recorded the dedicated repair-state table and batched write-unit decisions.
