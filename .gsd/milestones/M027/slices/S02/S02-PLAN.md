# S02: Timeout-Hardened Wiki Repair Path

**Goal:** Replace the fragile wiki embedding rewrite path with a resumable, bounded, model-correct repair flow that can repair only degraded wiki rows online without falling back to opaque timeouts or page-1 restarts.
**Demo:** An operator can run a wiki repair command against representative live wiki data, see stable progress/checkpoint output, resume safely after interruption, and finish with `voyage-context-3` writes plus post-run audit evidence instead of a timeout-prone monolithic backfill.

## Must-Haves

- Repair scope is limited to degraded wiki rows (`embedding IS NULL`, `stale = true`, or wrong `embedding_model`) and preserves the S01 invariant that wiki uses `voyage-context-3`.
- Wiki repair work is bounded into conservative contextual windows with hierarchical fallback, failure-class-aware retry behavior, and no immediate explosion to one-request-per-chunk unless smaller bounded windows also fail.
- Durable repair state is persisted separately from `wiki_sync_state` and records enough checkpoint/progress data to resume at sub-page granularity after interruption.
- Embedding writes are batched per bounded work unit and operator output exposes deterministic progress, counts, cursor state, and failure-class summaries in both JSON and human-readable modes.
- Slice proof includes automated regression coverage plus a representative live repair run that exercises the real production database/provider path and produces post-run audit/progress evidence.

## Proof Level

- This slice proves: operational
- Real runtime required: yes
- Human/UAT required: no

## Verification

- `bun test src/knowledge/wiki-embedding-repair.test.ts scripts/wiki-embedding-repair.test.ts scripts/verify-m027-s02.test.ts`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json`
- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json`
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`

## Observability / Diagnostics

- Runtime signals: structured repair progress records per bounded window including `run_id`, `page_id`, `page_title`, `window_index`, `windows_total`, `repaired`, `skipped`, `failed`, `failure_class`, `retry_count`, and `target_model`.
- Inspection surfaces: `bun run repair:wiki-embeddings [--json|--status|--resume]`, `bun run verify:m027:s02 -- --page-title "..." --json`, `bun run audit:embeddings --json`, and the dedicated wiki repair state rows persisted in Postgres.
- Failure visibility: last processed cursor, last failure class/message, last completed batch/window, cumulative counts, updated timestamp, and whether fallback split/retry logic was used.
- Redaction constraints: never log raw embedding vectors, Voyage credentials, or full chunk payload bodies; diagnostics should use page/chunk identifiers, counts, and summarized failure metadata only.

## Integration Closure

- Upstream surfaces consumed: `src/knowledge/runtime.ts`, `src/knowledge/embedding-audit.ts`, `src/knowledge/wiki-store.ts`, `src/knowledge/wiki-chunker.ts`, `src/knowledge/embeddings.ts`, and the existing `scripts/wiki-embedding-backfill.ts` operator surface.
- New wiring introduced in this slice: a reusable wiki embedding repair engine under `src/knowledge/`, a dedicated repair checkpoint/state surface in Postgres, a JSON-first repair CLI plus compatibility wrapper, and a repeatable S02 proof harness for representative live repair verification.
- What remains before the milestone is truly usable end-to-end: S03 must extend resumable repair to the remaining corpora and S04 must run the full integrated post-repair milestone proof across audit, repair, and retrieval verification.

## Tasks

- [x] **T01: Lock wiki repair contracts with failing tests** `est:45m`
  - Why: S02 needs fixed contracts for bounded-window splitting, failure-class routing, resumable checkpoints, and operator-visible progress before implementation broadens.
  - Files: `src/knowledge/wiki-embedding-repair.test.ts`, `scripts/wiki-embedding-repair.test.ts`, `scripts/verify-m027-s02.test.ts`
  - Do: Add failing tests for repair-target selection, conservative window splitting, timeout-vs-size failure routing, durable cursor advancement at sub-page granularity, batched write semantics, JSON/human CLI progress output, and the representative proof harness result envelope.
  - Verify: `bun test src/knowledge/wiki-embedding-repair.test.ts scripts/wiki-embedding-repair.test.ts scripts/verify-m027-s02.test.ts`
  - Done when: The new tests fail only because the repair engine/CLI/proof harness do not exist yet, and the failures name the exact contracts S02 must satisfy.
- [x] **T02: Implement bounded wiki repair engine and durable checkpoint state** `est:1h15m`
  - Why: This task fixes the timeout-prone core path by replacing full-page/row-at-a-time repair with bounded windows, failure-aware retries, batched updates, and resumable state.
  - Files: `src/knowledge/wiki-embedding-repair.ts`, `src/knowledge/wiki-store.ts`, `src/knowledge/embeddings.ts`, `src/knowledge/wiki-embedding-repair.test.ts`
  - Do: Build a reusable repair engine that scopes to degraded wiki rows, splits pages into conservative windows, distinguishes size-related failures from retryable transient failures, persists repair checkpoints separate from `wiki_sync_state`, and writes repaired embeddings in batches using `voyage-context-3`.
  - Verify: `bun test src/knowledge/wiki-embedding-repair.test.ts`
  - Done when: The engine can resume from persisted sub-page checkpoints, uses batched writes per window, and passes the contract tests for splitting, retry/fallback routing, and state advancement.
- [x] **T03: Ship the operator repair CLI, status surface, and compatibility wrapper** `est:1h`
  - Why: The repair engine is only operationally useful if operators can run it, inspect state, and keep existing wiki repair entrypoints from drifting onto the wrong path.
  - Files: `scripts/wiki-embedding-repair.ts`, `scripts/wiki-embedding-backfill.ts`, `package.json`, `docs/operations/embedding-integrity.md`, `scripts/wiki-embedding-repair.test.ts`
  - Do: Add a stable `repair:wiki-embeddings` command with JSON/human/status/resume modes, route the legacy wiki repair script through the new engine as a thin compatibility wrapper, document the operator contract, and keep model-correct defaults on `voyage-context-3`.
  - Verify: `bun test scripts/wiki-embedding-repair.test.ts && bun run repair:wiki-embeddings -- --status --json`
  - Done when: Operators have one explicit repair command with stable output fields and a readable status surface, and the legacy wrapper no longer points at the old timeout-prone monolith.
- [x] **T04: Add repeatable slice proof and execute representative live repair evidence** `est:1h`
  - Why: S02 owns operational hardening, so it must prove the real repair path completes on representative live data and leaves durable evidence future agents can inspect.
  - Files: `scripts/verify-m027-s02.ts`, `scripts/verify-m027-s02.test.ts`, `docs/operations/embedding-integrity.md`, `.gsd/REQUIREMENTS.md`
  - Do: Implement a proof harness that runs the representative wiki repair flow, checks repair-state/progress evidence, verifies resume behavior and post-run audit expectations, and then execute it against the outlier page target used in research.
  - Verify: `bun test scripts/verify-m027-s02.test.ts && bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`
  - Done when: The harness returns machine-checkable success with repair progress evidence, the representative live page completes without normal-case timeout failure, and requirement/proof docs can point at a repeatable command instead of a one-off shell transcript.

## Files Likely Touched

- `src/knowledge/wiki-embedding-repair.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/embeddings.ts`
- `scripts/wiki-embedding-repair.ts`
- `scripts/wiki-embedding-backfill.ts`
- `scripts/verify-m027-s02.ts`
- `docs/operations/embedding-integrity.md`
- `package.json`
- `.gsd/REQUIREMENTS.md`
