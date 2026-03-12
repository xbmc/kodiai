---
id: T02
parent: S03
milestone: M027
provides:
  - Shared non-wiki embedding repair engine with durable per-corpus cursor/count/failure state.
key_files:
  - src/knowledge/embedding-repair.ts
  - src/knowledge/review-comment-store.ts
  - src/db/migrations/029-embedding-repair-state.sql
  - src/knowledge/embedding-repair.test.ts
key_decisions:
  - Persist non-wiki repair state as one `embedding_repair_state` row per `corpus + repair_key`, updated once per bounded batch with JSONB failure counts.
patterns_established:
  - Review-comment repair is row-local and DB-driven: select degraded rows from Postgres, rebuild text from persisted `chunk_text`, and batch-write repaired embeddings without GitHub fetches.
observability_surfaces:
  - `embedding_repair_state` durable cursor/status/failure rows plus `run/status_code/failure_summary` fields returned by `runEmbeddingRepair()`.
duration: 1h20m
verification_result: passed
completed_at: 2026-03-12T08:10:00Z
blocker_discovered: false
---

# T02: Build the shared repair engine, generic state table, and live review-comment path

**Shipped the shared non-wiki repair engine, generic repair-state migration, and the first live `review_comments` repair path.**

## What Happened

I added `src/knowledge/embedding-repair.ts` with the shared non-wiki repair contract for S03:

- pinned all non-wiki repair runs to `voyage-code-3`
- preserved corpus-specific stale support differences
- rebuilt embedding text from persisted row content per corpus
- planned bounded row batches with resume-aware cursor filtering
- returned stable `success`, `status_code`, `cursor`, `failure_summary`, and `run` fields
- persisted state once per bounded batch and on terminal failure/no-op paths

I added `src/db/migrations/029-embedding-repair-state.sql` and `.down.sql` for the generic `embedding_repair_state` table. The table keeps corpus-scoped run identity, cursor fields, counts, status, resume readiness, and JSONB failure counts separate from ingestion sync state.

I extended `src/knowledge/review-comment-types.ts` and `src/knowledge/review-comment-store.ts` with repair helpers for the first live S03 corpus:

- degraded-row selection from `review_comments`
- durable repair-state reads/writes against `embedding_repair_state`
- batched embedding writes that clear `stale`
- a narrow `review_comments` adapter surface used by the shared engine

I also fixed a bug in `src/knowledge/embedding-repair.test.ts`: the fixture helper used `??` for `embedding` and `embedding_model`, which erased explicit `null` overrides and prevented the intended null-embedding contract from being expressed.

## Verification

Passed:

- `bun test src/knowledge/embedding-repair.test.ts`
- `bun test ./src/knowledge/embedding-repair.test.ts ./scripts/embedding-repair.test.ts ./scripts/verify-m027-s03.test.ts`
  - `src/knowledge/embedding-repair.test.ts` passed
  - `scripts/embedding-repair.test.ts` failed as expected because `scripts/embedding-repair.ts` is not implemented yet
  - `scripts/verify-m027-s03.test.ts` failed as expected because `scripts/verify-m027-s03.ts` is not implemented yet
- `bun -e 'await import("./src/knowledge/review-comment-store.ts"); console.log("review-comment-store ok")'`

Slice-level verification status after T02:

- `bun run repair:embeddings -- --corpus review_comments --json` → failed as expected: script not found
- `bun run repair:embeddings -- --corpus review_comments --status --json` → failed as expected: script not found
- `bun run repair:embeddings -- --corpus review_comments --resume --json` → failed as expected: script not found
- `bun run repair:embeddings -- --corpus issues --dry-run --json` → failed as expected: script not found
- `bun run verify:m027:s03 -- --corpus review_comments --json` → failed as expected: script not found
- `bun run audit:embeddings --json` → executed; still reports `review_comments` as critically degraded (`missing_or_null: 3033`) because the CLI/live repair proof is not wired yet

## Diagnostics

Future agents can inspect the new durable state directly in Postgres:

- table: `embedding_repair_state`
- key fields: `corpus`, `repair_key`, `run_id`, `status`, `resume_ready`, `batch_index`, `batches_total`, `last_row_id`, `processed`, `repaired`, `skipped`, `failed`, `failure_counts`, `last_failure_class`, `last_failure_message`, `updated_at`

Code-level inspection surfaces added in this task:

- `src/knowledge/embedding-repair.ts` — shared planner/runner/report envelope
- `src/knowledge/review-comment-store.ts` — review-comment degraded-row selector, durable state helpers, and batch write path

## Deviations

- Fixed the S03 contract test fixture in `src/knowledge/embedding-repair.test.ts` so explicit `null` overrides survive fixture construction. Without that change, the intended null-embedding repair cases were silently converted into healthy rows.

## Known Issues

- `scripts/embedding-repair.ts` does not exist yet, so the operator CLI verification commands still fail.
- `scripts/verify-m027-s03.ts` does not exist yet, so the slice proof harness is still red.
- The new migration was added but not exercised through a live repair CLI in this task.

## Files Created/Modified

- `src/knowledge/embedding-repair.ts` — shared non-wiki repair planner, runner, review-comment adapter, and stable report types.
- `src/db/migrations/029-embedding-repair-state.sql` — generic durable non-wiki repair-state table.
- `src/db/migrations/029-embedding-repair-state.down.sql` — rollback for the generic repair-state table.
- `src/knowledge/review-comment-store.ts` — review-comment repair candidate selection, state persistence, and batched repair writes.
- `src/knowledge/review-comment-types.ts` — repair candidate/state helper types and optional repair store methods.
- `src/knowledge/embedding-repair.test.ts` — fixed fixture null-handling so the locked S03 null-repair contract is actually exercised.
- `.gsd/milestones/M027/slices/S03/S03-PLAN.md` — marked T02 complete.
- `.gsd/DECISIONS.md` — recorded the durable non-wiki repair-state persistence decision.
