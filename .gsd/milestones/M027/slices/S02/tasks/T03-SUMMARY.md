---
id: T03
parent: S02
milestone: M027
provides:
  - Stable `repair:wiki-embeddings` operator CLI with JSON/human/status/resume modes and a legacy compatibility wrapper that stays on the bounded wiki repair path.
key_files:
  - scripts/wiki-embedding-repair.ts
  - scripts/wiki-embedding-backfill.ts
  - docs/operations/embedding-integrity.md
  - package.json
  - .gsd/milestones/M027/slices/S02/S02-PLAN.md
key_decisions:
  - Keep CLI stdout machine-readable by silencing migration/runtime logs inside the repair/status command.
  - Reject legacy `--model`, `--delay`, and `--dry-run` wrapper flags instead of emulating the old monolithic flow.
patterns_established:
  - Operator scripts render human output from the same report envelope used for `--json`, with stable top-level `success` and `status_code` fields.
  - Legacy entrypoints should delegate to the bounded repair CLI rather than preserving a second mutation path.
observability_surfaces:
  - `bun run repair:wiki-embeddings -- --status --json`
  - `wiki_embedding_repair_state`
  - human and JSON output from `scripts/wiki-embedding-repair.ts`
duration: ~45m
verification_result: passed
completed_at: 2026-03-11T15:25:00-07:00
blocker_discovered: false
---

# T03: Ship the operator repair CLI, status surface, and compatibility wrapper

**Shipped a JSON-first wiki repair CLI, a non-mutating status surface, and a legacy wrapper that now hard-stops the old timeout-prone backfill flags.**

## What Happened

Added `scripts/wiki-embedding-repair.ts` as the stable operator entrypoint for bounded wiki embedding repair. The CLI now supports `--page-title`, `--resume`, `--status`, `--json`, and `--help`, and it renders one stable report envelope for both human and machine-readable output.

The runtime path now uses the T02 bounded repair engine plus `contextualizedEmbedChunksForRepair()` so real repair runs stay on `voyage-context-3` and preserve failure classification for retries/splits. The CLI status path reads persisted checkpoint state from `wiki_embedding_repair_state` without rerunning embeddings.

Replaced the old `scripts/wiki-embedding-backfill.ts` implementation with a thin compatibility wrapper that forwards supported flags to the new CLI and rejects the old `--model`, `--delay`, and `--dry-run` surface. That removes the legacy monolithic repair code path and blocks accidental `voyage-code-3` drift.

Updated `package.json` with the stable `repair:wiki-embeddings` alias and extended `docs/operations/embedding-integrity.md` with the repair contract, status fields, resume behavior, checkpoint inspection SQL, and wrapper guidance.

## Verification

Passed:
- `bun test ./scripts/wiki-embedding-repair.test.ts`
- `bun run repair:wiki-embeddings -- --status --json` — returned machine-readable progress/checkpoint JSON (current environment reports `repair_resume_available`, so the process exits 1 after printing the JSON report)
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json`
- `bun scripts/wiki-embedding-backfill.ts --model voyage-code-3` — wrapper refused the legacy model override as intended
- `bun scripts/wiki-embedding-backfill.ts --status --json` — wrapper delegated to the new CLI/status surface

Slice-level verification run during this task:
- `bun test ./src/knowledge/wiki-embedding-repair.test.ts ./scripts/wiki-embedding-repair.test.ts ./scripts/verify-m027-s02.test.ts`
  - passed: `src/knowledge/wiki-embedding-repair.test.ts`
  - passed: `scripts/wiki-embedding-repair.test.ts`
  - still failing by plan: `scripts/verify-m027-s02.test.ts` because `scripts/verify-m027-s02.ts` is T04 scope and does not exist yet

## Diagnostics

Primary inspection surface:
- `bun run repair:wiki-embeddings -- --status --json`

Useful follow-ups:
- `bun run repair:wiki-embeddings -- --page-title "<title>" --json`
- `bun run repair:wiki-embeddings -- --page-title "<title>" --resume --json`
- `SELECT ... FROM wiki_embedding_repair_state ORDER BY updated_at DESC;` as documented in `docs/operations/embedding-integrity.md`

Failure visibility now includes:
- stable `status_code`
- `run.status`
- cursor fields (`page_id`, `page_title`, `window_index`, `windows_total`)
- cumulative counts (`repaired`, `skipped`, `failed`, `retry_count`)
- `failure_summary.by_class`
- `failure_summary.last_failure_class`
- `failure_summary.last_failure_message`
- `used_split_fallback`

## Deviations

None.

## Known Issues

- `scripts/verify-m027-s02.ts` and the `verify:m027:s02` package alias are still missing; the proof-harness contract test remains a planned T04 failure.
- The current status command reports the persisted global wiki repair checkpoint surface; it does not yet provide page-scoped status filtering.

## Files Created/Modified

- `scripts/wiki-embedding-repair.ts` — new bounded wiki repair CLI with JSON/human rendering, status mode, resume support, and real runtime wiring
- `scripts/wiki-embedding-backfill.ts` — legacy compatibility wrapper that forwards to the new CLI and rejects obsolete flags
- `package.json` — added the stable `repair:wiki-embeddings` script alias
- `docs/operations/embedding-integrity.md` — documented repair commands, stable fields, resume semantics, and checkpoint inspection guidance
- `.gsd/DECISIONS.md` — recorded the decision to reject legacy wrapper flags that could bypass the bounded repair path
- `.gsd/milestones/M027/slices/S02/S02-PLAN.md` — marked T03 complete
