---
id: T04
parent: S03
milestone: M027
provides:
  - Unified `repair:embeddings` CLI with stable JSON/human repair and status surfaces for all five non-wiki corpora
key_files:
  - scripts/embedding-repair.ts
  - package.json
  - docs/operations/embedding-integrity.md
  - src/knowledge/review-comment-store.ts
  - src/knowledge/issue-store.ts
  - src/knowledge/memory-store.ts
  - src/knowledge/code-snippet-store.ts
key_decisions:
  - The non-wiki operator command reuses the shared repair report envelope directly and derives human output from that same object to prevent drift between automation and operator surfaces.
  - Non-wiki status mode is DB-only and inspects `embedding_repair_state` plus current degraded-row presence instead of requiring another mutating repair run.
patterns_established:
  - One CLI covers `review_comments`, `learning_memories`, `code_snippets`, `issues`, and `issue_comments` through `--corpus`, with explicit separation between `--status`, `--resume`, and `--dry-run`.
  - Repair-state rows are normalized back to numbers when read from Postgres so cursor/count diagnostics remain machine-checkable instead of leaking stringified numerics.
observability_surfaces:
  - `bun run repair:embeddings -- --corpus <name> [--status|--resume|--dry-run] [--json]`
  - `embedding_repair_state` durable cursor/failure inspection documented in `docs/operations/embedding-integrity.md`
duration: 1h10m
verification_result: passed
completed_at: 2026-03-12T08:30:37Z
blocker_discovered: false
---

# T04: Ship the unified repair CLI, status surface, and operator docs

**Added the shared non-wiki repair operator command, wired it into package scripts, documented the persisted-row workflow, and fixed repair-state/store mapping bugs exposed by the live checks.**

## What Happened

I created `scripts/embedding-repair.ts` as the stable S03 operator surface for all remaining non-wiki corpora. It parses `--corpus`, `--status`, `--resume`, `--dry-run`, `--json`, and `--help`, then routes to the shared repair engine introduced in T02/T03. The script emits one stable report envelope for both human and JSON output, so automation and operators see the same `success`, `status_code`, `run`, and `failure_summary` state.

I wired the CLI into `package.json` as `repair:embeddings` and updated `docs/operations/embedding-integrity.md` with the S03 operator contract: supported corpora, example commands, status-code meanings, `embedding_repair_state` SQL inspection, and explicit guidance that this repair path is DB-driven from persisted row text rather than an old GitHub re-fetch/backfill loop.

Live verification exposed two real runtime bugs and I fixed both:
- `review_comments` repair candidates were not carrying the persisted `chunk_text` field expected by the shared text builder, so live repair failed even though the DB rows were healthy. I added `chunk_text` to the review-comment repair candidate mapping.
- Repair-state reads from Postgres were surfacing cursor/count numerics as strings in status output. I normalized those fields to numbers in all four non-wiki store repair-state readers (`review_comments`, `issues`, `learning_memories`, `code_snippets`) so CLI diagnostics stay stable and machine-checkable.

## Verification

Task-level verification run:
- `bun test ./scripts/embedding-repair.test.ts` ✅
- `bun run repair:embeddings -- --corpus issues --dry-run --json` ✅
  - Result: truthful no-op envelope with `success: true`, `status_code: "repair_not_needed"`, `dry_run: true`, and zeroed counts for the healthy/empty `issues` corpus.

Additional regression checks run:
- `bun test ./src/knowledge/embedding-repair.test.ts ./scripts/embedding-repair.test.ts` ✅
- `bun run repair:embeddings -- --corpus review_comments --status --json` ✅ command behavior / expected non-zero exit for resume-required status
  - Result: durable status surfaced `repair_resume_available` with numeric cursor fields (`batch_index`, `batches_total`, `last_row_id`, counts).
- `bun run audit:embeddings --json` ✅ command behavior / expected failure due known degraded `review_comments`

Slice-level verification status at end of T04:
- `bun test src/knowledge/embedding-repair.test.ts scripts/embedding-repair.test.ts scripts/verify-m027-s03.test.ts` ❌ expected partial failure because `scripts/verify-m027-s03.ts` belongs to T05 and is still missing.
- `bun run repair:embeddings -- --corpus review_comments --json` ⏱️ started real repair work and timed out in this task context after advancing persisted status; full live repair proof is owned by T05.
- `bun run repair:embeddings -- --corpus review_comments --status --json` ✅
- `bun run repair:embeddings -- --corpus issues --dry-run --json` ✅
- `bun run audit:embeddings --json` ✅ command behavior / expected degraded audit result because `review_comments` remain partially repaired until T05 completes the live proof.

## Diagnostics

Future agents/operators can inspect this work through:
- `bun run repair:embeddings -- --corpus <name> --json`
- `bun run repair:embeddings -- --corpus <name> --status --json`
- `bun run repair:embeddings -- --corpus <name> --resume --json`
- `bun run repair:embeddings -- --corpus <name> --dry-run --json`
- SQL against `embedding_repair_state` documented in `docs/operations/embedding-integrity.md`

The most useful fields are:
- top-level: `success`, `status_code`, `corpus`, `target_model`, `resumed`, `dry_run`
- run-level: `run_id`, `status`, `batch_index`, `batches_total`, `last_row_id`, `processed`, `repaired`, `skipped`, `failed`, `failure_summary`, `updated_at`

## Deviations

None.

## Known Issues

- `scripts/verify-m027-s03.ts` is still intentionally missing; the slice-wide proof-harness tests remain red until T05 implements it.
- The live `review_comments` repair run is larger than the task-level no-op probe and timed out in this session window after making real progress. T05 should resume from the persisted cursor and use the new status surface as the proof path.

## Files Created/Modified

- `scripts/embedding-repair.ts` — new unified non-wiki repair/status CLI and shared human/JSON renderer
- `package.json` — added `repair:embeddings` script alias
- `docs/operations/embedding-integrity.md` — documented S03 non-wiki repair contract, examples, SQL inspection, and operator guidance
- `src/knowledge/review-comment-store.ts` — fixed review-comment repair candidate mapping and normalized repair-state numerics
- `src/knowledge/issue-store.ts` — normalized repair-state numerics for status/report stability
- `src/knowledge/memory-store.ts` — normalized repair-state numerics for status/report stability
- `src/knowledge/code-snippet-store.ts` — normalized repair-state numerics for status/report stability
