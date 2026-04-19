---
id: S03
parent: M051
milestone: M051
provides:
  - A truthful parser/verifier contract for incomplete correlated phase-timing evidence.
  - A shared tri-state publication summary reused across the S01 and S03 M048 proof surfaces.
  - Aligned docs and handler typing so no stale PR #87 operator truthfulness cleanup remains on `main`.
requires:
  []
affects:
  []
key_files:
  - src/review-audit/phase-timing-evidence.ts
  - src/review-audit/phase-timing-evidence.test.ts
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s01.test.ts
  - scripts/verify-m048-s03.test.ts
  - docs/runbooks/review-requested-debug.md
  - src/handlers/review.ts
  - src/lib/review-utils.ts
key_decisions:
  - D128 — correlated phase rows missing `conclusion` and/or `published` are invalid-phase-payload evidence, not `ok`, while matched evidence stays visible for diagnosis.
  - D129 — operator-facing M048 summaries reserve `no correlated phase evidence available` for the true no-evidence path, render `publication unknown` for `published === null`, and keep S03 pinned to the S01 `outcome.summary` string.
  - Implemented D127 by replacing the local timeout-progress type literal in `src/handlers/review.ts` with the shared `TimeoutReviewDetailsProgress` export.
patterns_established:
  - Preserve matched-but-invalid evidence as explicit `invalid-phase-payload` data rather than collapsing it into either false-green success or false no-evidence wording.
  - When a downstream verifier/report surface publishes an upstream verdict, reuse the upstream summary string verbatim and regression-test the shared wording instead of creating a second prose path.
observability_surfaces:
  - Named missing-field issues from `buildPhaseTimingEvidence()` in `src/review-audit/phase-timing-evidence.test.ts`.
  - Shared `outcome.summary` assertions in `scripts/verify-m048-s01.test.ts` and verbatim reuse checks in `scripts/verify-m048-s03.test.ts`.
  - `docs/runbooks/review-requested-debug.md` M048 verifier section grep gate.
  - `bun run tsc --noEmit` proving the timeout Review Details type surface stays single-sourced.
drill_down_paths:
  - .gsd/milestones/M051/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M051/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M051/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-19T00:54:16.506Z
blocker_discovered: false
---

# S03: Residual operator truthfulness cleanup

**Closed the remaining PR #87 truthfulness debt by rejecting incomplete phase-timing payloads, restoring tri-state M048 verifier wording, and aligning the last stale docs/type surface on main.**

## What Happened

This slice finished the residual operator/verifier cleanup that was left behind after the manual rereview contract work. T01 hardened `buildPhaseTimingEvidence()` so correlated phase-summary rows missing `conclusion` and/or `published` no longer report `status: "ok"`; instead they surface `invalid-phase-payload` with named issues while still preserving the matched row identity, correlation fields, and normalized phases for diagnosis. T02 repaired `deriveM048S01Outcome()` so the operator-facing summary now distinguishes true no-evidence from incomplete-but-present evidence, renders `publication unknown` when `published === null`, and keeps `verify:m048:s03` pinned to the same `outcome.summary` text to prevent cross-surface wording drift. T03 removed the stale `M050` heading above the `verify:m048:*` runbook commands and replaced the local timeout progress type literal in `src/handlers/review.ts` with the exported `TimeoutReviewDetailsProgress` type from `src/lib/review-utils.ts`, clearing the last stranded closed-PR cleanup comment without changing runtime behavior. Together these changes make the M048 operator proof surfaces truthful when Azure payloads are partial, keep downstream reports aligned to the same summary contract, and leave the remaining M051 roadmap with no known PR #87 truthfulness debt on `main`.

## Verification

Fresh slice-close verification passed on the final assembled work:

- `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts` → 28/28 passing. Proved incomplete correlated phase rows now fail as `invalid-phase-payload`, preserve evidence, and keep the shared S01/S03 outcome summary contract green.
- `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts` → 142/142 passing. Proved downstream M048 compare/report reuse, timeout Review Details formatting, and review-handler wiring stayed green after the truthfulness cleanup.
- `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md` → exit 0. Proved the stale M050 heading is gone while the M048 verifier section and commands remain documented.
- `bun run tsc --noEmit` → exit 0. Proved the `TimeoutReviewDetailsProgress` type dedup and surrounding slice edits remain type-safe.

Observability/diagnostic confirmation:
- Parser/test surfaces now expose named missing-field issues for incomplete phase rows instead of false-green `ok` status.
- The repaired `outcome.summary` strings are exercised directly in `scripts/verify-m048-s01.test.ts` and reused verbatim by `scripts/verify-m048-s03.test.ts`.
- The runbook and compile outputs confirm the last stale operator/documentation/type drift is removed.

## Requirements Advanced

- R049 — Removed residual false-green/false-negative operator wording on the M048 review proof path so large-review latency evidence stays truthful when correlated phase payloads are incomplete.
- R050 — Hardened the durable phase-timing evidence contract and downstream operator-visible summaries so missing `conclusion`/`published` fields stay explicit on the proof surfaces instead of being silently reinterpreted.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

No live runtime proof was required for this slice; the contract is proven through deterministic parser/verifier/doc/type surfaces rather than fresh Azure/GitHub executions.

## Follow-ups

Milestone M051 can proceed to validation/closeout; no additional PR #87 truthfulness debt remains on `main` from this slice.

## Files Created/Modified

- `src/review-audit/phase-timing-evidence.ts` — Rejects incomplete correlated phase payloads as `invalid-phase-payload` while preserving matched evidence and normalized phases.
- `src/review-audit/phase-timing-evidence.test.ts` — Adds regressions for missing `conclusion` / `published` fields and malformed payload combinations.
- `scripts/verify-m048-s01.ts` — Restores truthful tri-state summary wording for no-evidence, incomplete evidence, and `publication unknown` states.
- `scripts/verify-m048-s01.test.ts` — Pins the repaired S01 outcome summary behavior for incomplete and unknown-publication evidence.
- `scripts/verify-m048-s03.test.ts` — Proves the downstream S03 report reuses the S01 `outcome.summary` string verbatim.
- `docs/runbooks/review-requested-debug.md` — Renames the stale M050 heading so the documented verifier section matches the `verify:m048:*` command family.
- `src/handlers/review.ts` — Replaces the inline timeout progress type literal with the shared `TimeoutReviewDetailsProgress` export.
