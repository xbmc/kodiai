---
id: S03
parent: M027
milestone: M027
provides:
  - Unified non-wiki embedding repair across review_comments, learning_memories, code_snippets, issues, and issue_comments with a shared CLI, durable repair state, and repeatable proof harness.
requires:
  - slice: S01
    provides: Stable audit/verifier contracts plus the corpus-model invariant that non-wiki corpora stay on `voyage-code-3`.
  - slice: S02
    provides: Bounded resumable repair pattern, dedicated repair-state persistence, and proof-harness structure for machine-checkable reruns.
affects:
  - S04
key_files:
  - src/knowledge/embedding-repair.ts
  - src/knowledge/review-comment-store.ts
  - src/knowledge/issue-store.ts
  - src/knowledge/memory-store.ts
  - src/knowledge/code-snippet-store.ts
  - src/db/migrations/029-embedding-repair-state.sql
  - scripts/embedding-repair.ts
  - scripts/verify-m027-s03.ts
  - docs/operations/embedding-integrity.md
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Persist non-wiki repair state in one `embedding_repair_state` row per `corpus + repair_key`, separate from ingestion sync state.
  - Keep non-wiki repair fully row-local and DB-driven by rebuilding embedding text only from persisted corpus data.
  - Scope the S03 proof harness audit verdict to the repaired corpus plus the no-op probe corpus while preserving the full audit envelope.
  - Healthy no-op reruns must not overwrite an existing repair checkpoint with synthetic zero-count state.
patterns_established:
  - One shared row-based repair engine can serve all remaining non-wiki corpora while preserving stale-support differences and per-corpus text shaping.
  - JSON-first operator surfaces (`repair:embeddings`, `verify:m027:s03`) render human output from the same report envelopes used by automation.
  - Durable cursor/count/failure metadata lives in Postgres and remains inspectable independently from transient logs.
observability_surfaces:
  - bun run repair:embeddings -- --corpus <name> --json
  - bun run repair:embeddings -- --corpus <name> --status --json
  - bun run repair:embeddings -- --corpus <name> --resume --json
  - bun run repair:embeddings -- --corpus <name> --dry-run --json
  - bun run verify:m027:s03 -- --corpus review_comments --json
  - bun run audit:embeddings --json
  - embedding_repair_state
drill_down_paths:
  - .gsd/milestones/M027/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M027/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M027/slices/S03/tasks/T03-SUMMARY.md
  - .gsd/milestones/M027/slices/S03/tasks/T04-SUMMARY.md
  - .gsd/milestones/M027/slices/S03/tasks/T05-SUMMARY.md
duration: ~4h45m
verification_result: passed
completed_at: 2026-03-12T02:07:03-07:00
---

# S03: Unified Online Repair for Remaining Corpora

**Shipped a shared non-wiki embedding repair system with resumable Postgres-backed state, one operator CLI for five corpora, and a repeatable proof harness that now verifies the repaired live system stays healthy.**

## What Happened

S03 took the bounded/resumable repair pattern established for wiki in S02 and generalized it across every remaining persisted embedding corpus: `review_comments`, `learning_memories`, `code_snippets`, `issues`, and `issue_comments`.

The slice started by locking the contract in tests. Those tests fixed the shared engine boundary before implementation: all non-wiki corpora stay on `voyage-code-3`, stale support exists only where the schema actually supports it, per-corpus embedding text must come from persisted row data only, and repair/status/proof surfaces must preserve stable machine-checkable fields.

With the contract fixed, S03 added `src/knowledge/embedding-repair.ts` plus the `029-embedding-repair-state` migration. The shared engine now:
- selects degraded rows using the S01 audit semantics
- plans bounded row batches
- writes durable cursor/count/failure state after each batch
- resumes from persisted cursor state
- exposes stable `success`, `status_code`, `failure_summary`, and `run` fields

The first live path targeted `review_comments`, because that corpus carried the known remaining degradation. Store helpers were added so repair candidates come directly from Postgres and rebuild text from persisted `chunk_text`, not from GitHub re-fetches.

S03 then extended the same pattern to the other four remaining corpora. `issues`, `issue_comments`, `learning_memories`, and `code_snippets` now all expose the same repair-state and batch-write helpers while keeping their schema-specific behavior intact. In particular:
- `issues` and `issue_comments` repair only null/missing or wrong-model rows
- `learning_memories` and `code_snippets` also honor `stale=true`
- `issue_comments` rebuild embedding text from persisted comment text plus persisted parent issue title
- `code_snippets` repair only from stored snippet rows and `embedded_text`

Once the engine existed, the slice shipped the operator CLI in `scripts/embedding-repair.ts`. Operators now have one stable command:
- `--corpus`
- `--status`
- `--resume`
- `--dry-run`
- `--json`

Human output is rendered from the same report envelope as JSON, so automation and manual use cannot drift. Status mode is DB-only and inspects `embedding_repair_state` plus current degraded-row presence instead of requiring another mutating run.

Finally, S03 added `scripts/verify-m027-s03.ts`, the repeatable proof harness for the non-wiki repair family. It preserves raw `repair_evidence`, `status_evidence`, `noop_probe_evidence`, and `audit_evidence` under stable check IDs. While finishing that harness, I also fixed a real observability defect: healthy no-op reruns could overwrite an existing repair checkpoint with a synthetic zero-count row. The engine now leaves existing checkpoints intact on healthy reruns so durable status remains useful after the corpus is repaired.

At completion time, the live `review_comments` corpus is healthy. That means the final rerun proof is intentionally idempotent rather than re-repairing degraded rows: `repair:embeddings` returns `repair_not_needed`, `--status` still reports the durable state surface, the `issues` dry-run probe proves a safe no-op path for another corpus, and `audit:embeddings --json` now reports all six audited corpora passing.

## Verification

Passed all slice-plan verification commands:

- `bun test ./src/knowledge/embedding-repair.test.ts ./scripts/embedding-repair.test.ts ./scripts/verify-m027-s03.test.ts`
- `bun run repair:embeddings -- --corpus review_comments --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`
- `bun run repair:embeddings -- --corpus review_comments --resume --json`
- `bun run repair:embeddings -- --corpus issues --dry-run --json`
- `bun run verify:m027:s03 -- --corpus review_comments --json`
- `bun run audit:embeddings --json`

Representative final-pass results:

- `verify:m027:s03` returned `overallPassed=true` and `status_code=m027_s03_ok`
- `repair:embeddings -- --corpus review_comments --json` returned `success=true`, `status_code=repair_not_needed`
- `repair:embeddings -- --corpus review_comments --status --json` returned `success=true`, `status_code=repair_completed`
- `repair:embeddings -- --corpus review_comments --resume --json` returned `success=true`, `resumed=true`, `status_code=repair_not_needed`
- `repair:embeddings -- --corpus issues --dry-run --json` returned a truthful no-op envelope with `status_code=repair_not_needed`
- `audit:embeddings --json` returned `success=true`, `status_code=audit_ok`, and `review_comments.missing_or_null=0`, `model_mismatch=0`

Observability/diagnostic surface check:

- `repair:embeddings -- --status --json` exposes durable machine-readable state from Postgres instead of making operators infer success from transient logs
- `verify:m027:s03 --json` preserves raw evidence and stable check IDs so future agents can localize which repair boundary regressed
- the proof remains honest on reruns: an already-healthy corpus is reported as `repair_not_needed`, not as a fake mutating success

## Requirements Advanced

- R020 — completed the all-remaining-corpora repair path with one explicit resumable operator contract.
- R022 — extended the timeout-hardened bounded-repair pattern from wiki to the representative non-wiki live repair path.
- R024 — added regression tests and a repeatable S03 proof harness that lock repair/status/no-op/audit behavior.

## Requirements Validated

- R020 — validated by the shared `repair:embeddings` repair/status/resume/no-op commands plus `verify:m027:s03` preserving live repair/no-op/audit evidence.
- R022 — validated for the non-wiki family by the bounded live `review_comments` repair path and repeatable idempotent proof reruns without timeout-class failure.
- R024 — validated by the combined contract tests and `verify:m027:s03` proof harness for non-wiki repair drift.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

- One observability fix landed during completion work: healthy reruns now preserve an existing `embedding_repair_state` checkpoint instead of overwriting it with synthetic zero-count no-op state.

## Known Limitations

- `embedding_repair_state` keeps the latest durable row per `corpus + repair_key`, not a historical timeline of every repair attempt.
- The current live proof reruns against already-healthy `review_comments`, so the final verification pass proves idempotent health and status/audit truthfulness rather than replaying the original degraded-state repair.
- `issue_comments` are audited and repairable, but they still are not part of the live retriever unless later milestone work changes that system boundary.

## Follow-ups

- S04 still needs to run the milestone-level integrated proof across audit, both repair families, and the live retriever path in one production-style acceptance pass.
- If operators later need per-run repair history rather than latest-state inspection, add a separate append-only repair-run log instead of overloading `embedding_repair_state`.

## Files Created/Modified

- `src/knowledge/embedding-repair.ts` — shared bounded/resumable repair engine for all non-wiki corpora.
- `src/db/migrations/029-embedding-repair-state.sql` — durable Postgres state table for non-wiki repair cursor/count/failure metadata.
- `src/db/migrations/029-embedding-repair-state.down.sql` — rollback for the repair-state table.
- `src/knowledge/review-comment-store.ts` — review-comment repair candidate, state, and write helpers.
- `src/knowledge/issue-store.ts` — issue and issue-comment repair candidate, state, and write helpers.
- `src/knowledge/memory-store.ts` — learning-memory repair candidate, state, and write helpers.
- `src/knowledge/code-snippet-store.ts` — code-snippet repair candidate, state, and write helpers.
- `scripts/embedding-repair.ts` — unified operator CLI for repair, status, resume, and dry-run modes.
- `scripts/verify-m027-s03.ts` — repeatable S03 proof harness with stable check IDs and preserved raw evidence.
- `docs/operations/embedding-integrity.md` — operator runbook for non-wiki repair and proof verification.
- `.gsd/REQUIREMENTS.md` — requirement validation text updated for S03 proof coverage.
- `.gsd/DECISIONS.md` — recorded repair-state, proof-scope, and healthy-rerun checkpoint decisions.

## Forward Intelligence

### What the next slice should know
- `verify:m027:s03 --json` is the fastest authoritative proof surface for the non-wiki repair family because it preserves repair, status, no-op, and audit evidence together.
- Healthy reruns are expected now. The operator contract must stay honest about `repair_not_needed` while keeping durable status useful.
- The shared repair engine already captures the main reusable seams for S04: degraded-row planning, bounded execution, persistent status, and proof-envelope composition.

### What's fragile
- `embedding_repair_state` is latest-state only — useful for operations, but not enough if S04 or later work needs historical run forensics.
- The representative `review_comments` corpus is already healthy, so future regressions in the original degraded-path behavior will need either preserved historical evidence or a deliberately reintroduced fixture-level degradation to reproduce cheaply.

### Authoritative diagnostics
- `bun run verify:m027:s03 -- --corpus review_comments --json` — best single-command S03 proof.
- `bun run repair:embeddings -- --corpus review_comments --status --json` — authoritative persisted status surface for the non-wiki repair state row.
- `bun run audit:embeddings --json` — authoritative all-corpus health check after repair work.

### What assumptions changed
- The assumption that a successful proof rerun must rewrite rows changed — once the live degraded corpus is repaired, the right result is often `repair_not_needed` plus a passing status/audit proof.
- The assumption that a no-op rerun can safely persist new zero-count state changed — doing so weakens post-repair observability, so existing checkpoints now remain authoritative until new degraded work appears.
