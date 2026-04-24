---
id: S03
parent: M061
milestone: M061
provides:
  - Bounded named review prompt sections that downstream caching/reuse work can target safely
  - Truthful multi-section review telemetry on both initial and retry review paths
  - An operator proof surface for review section budgets/truncation that downstream milestone proof can reuse
requires:
  []
affects:
  - S04
  - S05
key_files:
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/handlers/review.test.ts
  - scripts/usage-report.ts
  - scripts/usage-report.test.ts
  - scripts/verify-m061-s03.ts
  - scripts/verify-m061-s03.test.ts
  - .gsd/PROJECT.md
key_decisions:
  - Kept the external telemetry contract at `promptKind: "review.user-prompt"` while splitting review prompt accounting into stable named sections.
  - Applied explicit budgets only to volatile expensive review sections so compaction reduces spend without silently dropping core review/safety guidance.
  - Reused the shared usage-report query layer for S03 proof checks and hardened it with bounded timeout plus explicit postgres shutdown so unreachable Postgres fails open instead of hanging.
patterns_established:
  - Use text-free named prompt sections plus per-section `charCount`, `estimatedTokens`, and `truncated` metrics as the canonical accounting seam for prompt optimization work.
  - When adding operator proof scripts, reuse the canonical reporting/query layer instead of building verifier-only SQL paths.
  - For Bun CLI smoke verifiers that may auto-load `.env`, bound database access and force client shutdown so database-unavailable environments are observable and non-blocking.
observability_surfaces:
  - `prompt_section_events` review rows under the existing `review.user-prompt` prompt kind
  - `bun scripts/usage-report.ts` canonical reporting output aligned to named review sections
  - `bun scripts/verify-m061-s03.ts --json` fail-open verifier for review section budgets and truncation visibility
drill_down_paths:
  - .gsd/milestones/M061/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M061/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M061/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-24T02:20:01.118Z
blocker_discovered: false
---

# S03: S03

**Compacted review prompt assembly into bounded named sections, preserved unified knowledge-context preference, and exposed per-section budget/truncation evidence through the existing review.user-prompt telemetry and verifier surfaces.**

## What Happened

S03 replaced the monolithic review prompt assembly with an explicit named-section builder in `src/execution/review-prompt.ts`. The review path now emits stable section boundaries for PR context, change context, size/boundedness context, graph/structural evidence, knowledge context, and the instruction-heavy tail, while applying documented char budgets only to the volatile expensive sections. The unified retrieval path remains preferred whenever `unifiedResults` are present, so legacy retrieval/precedent/wiki sections stay omitted in unified mode while core instruction and safety guidance remain intact.

The handler contract stayed stable at the external seam: both initial and retry review execution still persist telemetry under `promptKind: "review.user-prompt"`, but now carry multiple truthful prompt section rows rather than one coarse blob. Regression coverage in `src/handlers/review.test.ts` proves the handler consumes builder-produced metrics directly and preserves truncation metadata on both the normal and reduced-scope retry paths.

The slice also extended the operator proof surface. `scripts/usage-report.ts` and its tests were aligned with the new named review section contract, and `scripts/verify-m061-s03.ts` was added to prove that review deliveries attribute prompt sections under `review.user-prompt` and expose truncation evidence without reading raw prompt text. During this work, the shared reporting/query path was hardened so Bun auto-loading `.env` cannot leave usage-report or verifier CLI commands hanging on unreachable Postgres; the canonical query layer now times out and explicitly shuts down the Postgres client so database-unavailable runs fail open with explicit preflight output.

Assumption carried into closure: the slice-level smoke verifier is allowed to report `databaseAccess: unavailable` in this environment as long as it exits cleanly and surfaces the fail-open preflight state, because the plan explicitly required a fail-open smoke run rather than a live-Postgres proof in this slice.

## Verification

Fresh slice verification ran after the last code changes with:

- `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/usage-report.test.ts scripts/verify-m061-s03.test.ts`
- `bun scripts/verify-m061-s03.ts --json`

Results:
- Test suite passed: `357 pass, 0 fail` across the four required files.
- The verifier smoke run exited successfully and produced JSON showing fail-open preflight behavior: `databaseAccess: unavailable` with `connect ECONNREFUSED 127.0.0.1:5432`.

This satisfies the slice proof contract:
- contract proof via `src/execution/review-prompt.test.ts` for named sections, budgets, and truncation semantics
- integration proof via `src/handlers/review.test.ts` for persisted multi-section `review.user-prompt` telemetry on initial and retry flows
- operator proof via `scripts/usage-report.test.ts`, `scripts/verify-m061-s03.test.ts`, and the fail-open smoke run of `scripts/verify-m061-s03.ts --json`
- observability surface confirmed through the canonical `prompt_section_events` / usage-report / verifier path, with explicit text-free section metrics and truncation visibility

## Requirements Advanced

- R068 — Improved durable operator evidence by making review prompt growth attributable by named section and exposing truncation/fail-open reporting through the canonical usage-report and verifier surfaces.
- R069 — Compacted review prompt assembly without changing the external review publication contract or retry semantics, adding regression coverage to protect normal review behavior while optimizing prompt spend.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

T02 turned out to be wiring verification rather than production code change because `src/handlers/review.ts` already threaded the prompt-builder section metrics correctly; the task work focused on regression coverage that locks the contract in place. T03 also expanded the shared `scripts/usage-report.ts` query path because local verification exposed a real operator failure mode: Bun auto-loaded `.env`, attempted a live Postgres connection, and the smoke verifier could hang without a bounded timeout/shutdown fix.

## Known Limitations

The fresh smoke verification in this closure environment exercised only the required fail-open path because local Postgres was unreachable (`connect ECONNREFUSED 127.0.0.1:5432`). This slice proves the operator surface and bounded failure behavior, but not a live populated-telemetry run in this environment; S05 remains responsible for integrated end-to-end reduction proof on representative flows.

## Follow-ups

S04 should reuse the new review section boundaries when deciding what derived review context can be cached or reused safely. S05 should include a live Postgres-backed proof run that demonstrates real token reduction by section on representative review paths, not just fail-open operator behavior.

## Files Created/Modified

- `src/execution/review-prompt.ts` — Refactored review prompt assembly into budgeted named sections and exposed per-section metrics/truncation state.
- `src/execution/review-prompt.test.ts` — Added contract coverage for named sections, section budgets, and truncation semantics.
- `src/handlers/review.test.ts` — Added initial and retry review telemetry regression tests for multi-section `review.user-prompt` persistence.
- `scripts/usage-report.ts` — Hardened shared telemetry query access with bounded timeout and explicit Postgres shutdown for fail-open CLI behavior.
- `scripts/usage-report.test.ts` — Aligned reporting expectations with named review section attribution.
- `scripts/verify-m061-s03.ts` — Added slice verifier for review section budgets, truncation evidence, and fail-open Postgres preflight behavior.
- `scripts/verify-m061-s03.test.ts` — Added proof tests for verifier pass/fail/fail-open cases.
- `.gsd/PROJECT.md` — Refreshed project state to mark S03 complete and document the new review prompt compaction status.
