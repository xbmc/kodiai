---
id: S02
parent: M027
milestone: M027
provides:
  - Timeout-hardened wiki-only embedding repair with bounded windows, durable checkpoint state, JSON-first operator commands, and a repeatable live proof harness.
requires:
  - slice: S01
    provides: Stable audit/verifier contracts plus the corpus-model invariant that wiki must use `voyage-context-3`.
affects:
  - S03
  - S04
key_files:
  - src/knowledge/wiki-embedding-repair.ts
  - src/knowledge/wiki-store.ts
  - src/knowledge/embeddings.ts
  - src/db/migrations/028-wiki-embedding-repair-state.sql
  - scripts/wiki-embedding-repair.ts
  - scripts/wiki-embedding-backfill.ts
  - scripts/verify-m027-s02.ts
  - docs/operations/embedding-integrity.md
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Persist wiki repair progress in dedicated `wiki_embedding_repair_state` rows rather than overloading `wiki_sync_state`.
  - Keep the wiki repair path pinned to `voyage-context-3` and reject legacy wrapper flags that could bypass the bounded engine.
  - Make the S02 proof harness preserve raw repair, status, and audit envelopes with stable check IDs so idempotent reruns remain machine-checkable.
patterns_established:
  - Repair only degraded rows, then process them in conservative contextual windows with retry-vs-split failure routing and batched per-window writes.
  - Render human CLI output from the same JSON-first report envelope used by `--json`, with stable `success` and `status_code` fields.
  - Preserve durable cursor, count, and failure metadata in Postgres so resume and post-run inspection do not depend on logs.
observability_surfaces:
  - bun run repair:wiki-embeddings -- --status --json
  - bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json
  - bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json
  - bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json
  - wiki_embedding_repair_state
  - bun run audit:embeddings --json
drill_down_paths:
  - .gsd/milestones/M027/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M027/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M027/slices/S02/tasks/T03-SUMMARY.md
  - .gsd/milestones/M027/slices/S02/tasks/T04-SUMMARY.md
duration: ~4h20m
verification_result: passed
completed_at: 2026-03-12T07:35:53Z
---

# S02: Timeout-Hardened Wiki Repair Path

**Shipped a bounded, resumable, model-correct wiki embedding repair path with durable checkpoint state, stable operator commands, and repeatable live proof on the representative timeout-risk page.**

## What Happened

S02 replaced the old fragile wiki embedding rewrite path with an explicit repair engine under `src/knowledge/wiki-embedding-repair.ts`. The new path plans only degraded wiki rows (`embedding IS NULL`, stale rows, or wrong-model rows), keeps wiki pinned to `voyage-context-3`, splits work into conservative contextual windows, and handles failures by distinguishing transient retry cases from size-pressure split cases.

To make resume and inspection real instead of log-only, the slice added a dedicated `wiki_embedding_repair_state` table plus store helpers for checkpoint persistence, batched per-window embedding writes, and durable failure metadata. That keeps repair cursor state independent from `wiki_sync_state` and exposes enough detail to resume at sub-page granularity after interruption.

S02 then shipped the operator surface. `scripts/wiki-embedding-repair.ts` provides the stable `repair:wiki-embeddings` command with `--json`, `--status`, `--resume`, and `--page-title` modes. The legacy `scripts/wiki-embedding-backfill.ts` path now delegates to the bounded repair CLI and explicitly rejects old flags like `--model`, `--delay`, and `--dry-run` so operators cannot drift back onto the monolithic or wrong-model path.

The slice finished by adding `scripts/verify-m027-s02.ts`, a repeatable proof harness that runs repair, status, and audit surfaces in sequence and preserves the raw evidence envelopes under stable check IDs. Running the live proof against `JSON-RPC API/v8` also exposed and fixed two real runtime defects that fixture tests missed: the Voyage contextualized embeddings endpoint needed to use `/v1/contextualizedembeddings`, and live batched write payloads needed camelCase `chunkId` normalization. After those fixes, the representative page completed through the bounded path with durable checkpoint evidence showing `388` repaired chunks across `49` windows, `failed=0`, and `used_split_fallback=false`.

## Verification

Passed all slice-plan verification commands:

- `bun test src/knowledge/wiki-embedding-repair.test.ts scripts/wiki-embedding-repair.test.ts scripts/verify-m027-s02.test.ts`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json`
- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json`
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`

Representative runtime evidence from the final verification pass:

- repair command returned `success=true`, `status_code=repair_completed`, target model `voyage-context-3`
- status command exposed durable checkpoint state for page `JSON-RPC API/v8` with `page_id=13137`, `windows_total=49`, `repaired=388`, `failed=0`, `retry_count=0`, `used_split_fallback=false`
- resume command succeeded on already-repaired state and preserved the last durable cursor instead of restarting from page 1
- proof harness returned `overallPassed=true`, `status_code=m027_s02_ok`, and preserved raw `repair_evidence`, `status_evidence`, and `audit_evidence`
- audit evidence still honestly reports unrelated `review_comments` degradation while showing `wiki_pages` at `missing_or_null=0`, `stale=0`, `model_mismatch=0`, `actual_models=["voyage-context-3"]`

Observability/diagnostic surface check:

- `repair:wiki-embeddings -- --status --json` exposes actionable cursor, counts, and failure-summary fields from persisted Postgres state rather than ephemeral stdout
- `verify:m027:s02 --json` keeps raw evidence payloads alongside stable check IDs, so hidden failures are not collapsed into a single summary line
- full-audit failure remains visible during wiki proof runs; the slice does not claim milestone-wide repair success when unrelated corpora are still degraded

## Requirements Advanced

- R020 — Wiki repair is now operationally proven with explicit, resumable, online-safe repair commands and durable progress/reporting, establishing the reference repair contract for later corpora.
- R022 — The dominant wiki timeout-risk path is now bounded, retry-aware, resumable, and proven on representative live data instead of relying on the old monolithic backfill behavior.
- R024 — Contract tests plus the repeatable `verify:m027:s02` harness now guard the wiki repair path against timeout-regression, output-contract drift, and proof-envelope weakening.

## Requirements Validated

- none — S02 intentionally validates only the wiki repair slice; milestone-wide all-corpus repair validation remains for later slices.

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- R020 — proof remains intentionally wiki-scoped after S02; non-wiki repair coverage still belongs to S03/S04.
- R022 — timeout hardening is now proven for the wiki path only, not for every remaining corpus-specific repair path.
- R024 — regression coverage advanced for wiki repair and proof contracts, but broader non-wiki repair coverage remains later-slice work.

## Deviations

- None. The slice stayed within plan, though live proof execution exposed two real runtime defects that were fixed inside planned scope.

## Known Limitations

- The proof is intentionally wiki-only. `audit:embeddings` still reports unrelated `review_comments` degradation in this environment, so the milestone is not yet all-green.
- `repair:wiki-embeddings -- --status --json` currently reports the latest persisted wiki repair checkpoint globally, not a page-filtered status view.
- Idempotent resume runs on already-healthy state can return `windows_total: null`; the durable checkpoint record is the authoritative proof surface for prior completion.

## Follow-ups

- Extend the bounded/resumable repair pattern to `learning_memories`, `review_comments`, `code_snippets`, `issues`, and `issue_comments` in S03.
- Reuse the S02 proof-envelope pattern in later repair verifiers so each corpus keeps stable check IDs plus preserved raw evidence.
- Consider adding page-scoped status filtering if operators need to inspect multiple wiki repair targets concurrently.

## Files Created/Modified

- `src/knowledge/wiki-embedding-repair.ts` — bounded wiki repair planner/executor with retry-vs-split routing, batched writes, and resume checkpoints.
- `src/knowledge/wiki-store.ts` — degraded-row selection, repair checkpoint persistence, and batched per-window embedding updates.
- `src/knowledge/embeddings.ts` — repair-oriented contextualized embedding wrapper plus corrected Voyage contextualized endpoint wiring.
- `src/db/migrations/028-wiki-embedding-repair-state.sql` — dedicated Postgres state table for resumable wiki repair progress.
- `src/db/migrations/028-wiki-embedding-repair-state.down.sql` — rollback for the repair-state table.
- `src/knowledge/wiki-types.ts` — repair checkpoint and batch-write types for the new store/engine surface.
- `scripts/wiki-embedding-repair.ts` — stable JSON-first operator CLI for repair, resume, and status modes.
- `scripts/wiki-embedding-backfill.ts` — compatibility wrapper that forwards onto the bounded repair path and rejects obsolete flags.
- `scripts/verify-m027-s02.ts` — repeatable slice proof harness with stable check IDs and preserved raw evidence.
- `docs/operations/embedding-integrity.md` — operator and proof-harness documentation for the wiki repair path.
- `.gsd/REQUIREMENTS.md` — updated requirement validation text to reflect honest wiki-only proof scope.
- `.gsd/DECISIONS.md` — recorded the dedicated repair-state, wrapper-guardrail, proof-envelope, and endpoint decisions.

## Forward Intelligence

### What the next slice should know
- The durable status row in `wiki_embedding_repair_state` is the strongest proof surface for completion; idempotent reruns may legitimately repair zero rows while the persisted checkpoint still proves the prior bounded run finished.
- The repair engine already normalizes both snake_case test fixtures and camelCase runtime rows; future corpus repair engines should keep that same normalization seam instead of assuming one record shape.
- The audit proof must stay honest. S02 passes because `wiki_pages` is healthy inside the preserved full audit envelope, not because the full system is healthy.

### What's fragile
- `repair:wiki-embeddings -- --status --json` currently returns the latest repair row, not a page-filtered view — this is fine for single-target proof but could become ambiguous once operators repair multiple pages frequently.
- Provider-path correctness can still hide behind otherwise-good fixtures — the bad Voyage endpoint wiring only surfaced under live proof execution.

### Authoritative diagnostics
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json` — best single-command proof because it preserves repair, status, and audit evidence together.
- `bun run repair:wiki-embeddings -- --status --json` — authoritative persisted checkpoint surface for cursor, counts, and last-failure inspection.
- `bun run audit:embeddings --json` — authoritative source for distinguishing a healthy wiki corpus from broader milestone-wide degradation.

### What assumptions changed
- The assumption that contract tests were enough to validate the repair path changed — live proof execution exposed both provider-endpoint and write-payload-shape defects that fixtures did not catch.
- The assumption that a successful repair run must always rewrite rows changed — once the representative page is healthy, reruns can be correctly idempotent and must still remain machine-checkable.
