---
id: S01
parent: M061
milestone: M061
provides:
  - A stable Postgres telemetry baseline for token, delivery, cache, and prompt-section attribution across review, mention, and Slack paths.
  - Named prompt-section measurement seams that downstream optimization slices can use to prove reductions by section instead of by raw prompt text.
  - Documented operator commands and runbook guidance for baseline telemetry inspection and verification.
requires:
  []
affects:
  - S02
  - S03
  - S04
  - S05
key_files:
  - src/db/migrations/038-prompt-section-events.sql
  - src/telemetry/store.ts
  - src/execution/prompt-section-metrics.ts
  - src/handlers/mention.ts
  - src/handlers/review.ts
  - scripts/usage-report.ts
  - scripts/phase72-telemetry-follow-through.ts
  - scripts/phase75-live-ops-verification-closure.ts
  - scripts/verify-m061-s01.ts
  - docs/runbooks/review-requested-debug.md
key_decisions:
  - Persist prompt-section accounting in a dedicated `prompt_section_events` table keyed by delivery/task/prompt path and never store raw prompt text.
  - Capture prompt-section metrics at prompt-builder seams and thread them through both local and Agent SDK execution paths rather than reconstructing them after prompt rendering.
  - Structure operator telemetry scripts as pure query/render helpers behind a thin `createDbClient()` CLI wrapper with explicit `available`/`missing`/`unavailable` access-state reporting.
patterns_established:
  - Text-free prompt accounting is the canonical telemetry pattern for prompt-size analysis in this repo.
  - Operator verification scripts should fail open with explicit database access reporting instead of consulting stale fallback stores.
  - Slice-level proof commands should compose existing report/query layers rather than duplicate SQL so verifier behavior stays aligned with the operator surface.
observability_surfaces:
  - `prompt_section_events` persistence for named prompt-section metrics by delivery/task/prompt path.
  - Postgres-backed `report` output over `llm_cost_events`, `prompt_section_events`, and `rate_limit_events`.
  - Postgres-backed `verify:phase72`, `verify:phase75`, and `verify:m061:s01` proof surfaces with explicit preflight access-state reporting.
drill_down_paths:
  - .gsd/milestones/M061/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M061/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M061/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M061/slices/S01/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-24T01:04:51.722Z
blocker_discovered: false
---

# S01: Token Accounting Baseline and Reporting Repair

**Established a Postgres-backed telemetry baseline with durable prompt-section accounting, repaired operator reporting/verifier surfaces, and published a rerunnable slice proof for review, mention, and Slack execution paths.**

## What Happened

This slice replaced the stale SQLite-era usage path with a live-schema Postgres reporting baseline and added the storage/runtime seams needed to measure prompt reductions truthfully in later slices. T01 introduced a dedicated `prompt_section_events` table plus text-free contracts and store writes so delivery/task/prompt-path attribution can persist named section metrics without storing raw prompt text. T02 instrumented the real mention and review prompt-building seams to emit deterministic section metrics and threaded those records through both local and Agent SDK execution paths so handlers can persist the same telemetry for remote runs. T03 rebuilt the operator-facing usage and phase72/phase75 verifier scripts around `createDbClient()` and pure query/render helpers, exposing explicit database access preflight states (`available`, `missing`, `unavailable`) and current-schema attribution surfaces instead of the removed SQLite fallback. T04 closed the loop with `verify:m061:s01`, updated runbooks/smoke docs, and aligned the slice-level proof surface with the repaired report path so downstream slices can measure token, cache, delivery, and prompt-section changes against a stable baseline. The slice delivered the dependency seam M061 needs: later context-diet, prompt-compaction, and caching work can compare named prompt sections and task paths instead of reverse-engineering raw prompt text or stale telemetry assumptions.

## Verification

Fresh slice verification passed after the final code state: `bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts && bun run lint` completed successfully with 279 passing tests, 17 environment-gated skips in `src/telemetry/store.test.ts`, and 0 failures. Operational surfaces were also exercised in fail-open mode without database credentials by calling the exported CLIs directly via Bun eval: `runM061S01BaselineProofCli([], {})` returned `databaseAccess: missing` with the expected explicit preflight detail, and `runUsageReportCli([], {})` returned the same fail-open access-state report instead of consulting a stale SQLite path. This verifies the slice contract at three levels: targeted telemetry/prompt-builder tests, operator script/verifier tests, and operator-visible fail-open reporting behavior when live Postgres access is unavailable in the current environment.

## Requirements Advanced

- R068 — strengthens durable operator evidence patterns for review/mention execution telemetry, though the current requirements projection does not yet map M061 explicitly.

## Requirements Validated

None.

## New Requirements Surfaced

- Roadmap/requirements metadata is out of sync for M061: the slice plan references R056–R060, but the current requirements projection still lists M052–M055-era large-PR lifecycle requirements. Downstream planning should reconcile milestone-to-requirement mapping before claiming validation status changes.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

None at slice scope beyond the migration filename correction already captured in T01 (`038-prompt-section-events.sql` instead of the stale planned `011-*` path).

## Known Limitations

Live Postgres-backed proof was not exercised end-to-end in this completion environment because no database credentials were available. The slice therefore proves the schema/query/report contracts, fail-open operator behavior, and targeted telemetry seams here, while the live PASS path still requires operators to run the documented commands against real telemetry.

## Follow-ups

S02 should use the new mention prompt/context section metrics to quantify reductions by named section instead of comparing rendered prompt text. S03 should adopt the same accounting for review prompt budgets and preserve the established `review.full` delivery/task-path attribution. S04 should reuse the explicit rate-limit/cache evidence surfaces rather than adding separate cache-reporting paths.

## Files Created/Modified

- `src/db/migrations/038-prompt-section-events.sql` — Added durable Postgres storage for named prompt-section telemetry.
- `src/telemetry/store.ts` — Persisted prompt-section records and cleaned them up with the telemetry store lifecycle.
- `src/execution/prompt-section-metrics.ts` — Added shared deterministic prompt-section metric construction utilities.
- `src/handlers/mention.ts` — Persisted mention prompt/context section telemetry in the live execution path.
- `src/handlers/review.ts` — Persisted review prompt section telemetry in normal and retry flows.
- `scripts/usage-report.ts` — Rebuilt the main operator usage report on Postgres-backed telemetry with fail-open preflight messaging.
- `scripts/phase72-telemetry-follow-through.ts` — Moved the phase72 verifier to current-schema Postgres queries and fail-open preflight handling.
- `scripts/phase75-live-ops-verification-closure.ts` — Moved the phase75 verifier to current-schema Postgres queries and fail-open preflight handling.
- `scripts/verify-m061-s01.ts` — Added the slice-level baseline proof command for telemetry/task-path/prompt-section/cache evidence.
- `docs/runbooks/review-requested-debug.md` — Updated operator guidance to the repaired Postgres-backed report and verifier flow.
