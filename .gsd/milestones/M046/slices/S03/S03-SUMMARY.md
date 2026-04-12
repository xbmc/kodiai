---
id: S03
parent: M046
milestone: M046
provides:
  - A reusable `src/contributor/calibration-change-contract.ts` helper that turns the S02 recommendation into a structured M047 keep/change/replace contract with explicit impacted surfaces.
  - The canonical `verify:m046` milestone-closeout proof surface that preserves nested fixture and calibration evidence in one integrated report.
  - A concrete `m047ChangeContract` that tells M047 what to keep, what consumer seams to change, and what live scoring mechanism to replace.
requires:
  - slice: S01
    provides: The checked-in xbmc manifest/snapshot corpus plus the `verify:m046:s01` prerequisite proof surface with retained/excluded truth, provenance, and source-availability diagnostics.
  - slice: S02
    provides: The pure calibration evaluator, stable `verify:m046:s02` report shape, and explicit `replace` recommendation that S03 composes into the milestone-level verdict.
affects:
  - M047
key_files:
  - src/contributor/calibration-change-contract.ts
  - src/contributor/calibration-change-contract.test.ts
  - src/contributor/index.ts
  - scripts/verify-m046.ts
  - scripts/verify-m046.test.ts
  - package.json
  - .gsd/milestones/M046/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M046/slices/S03/tasks/T02-SUMMARY.md
key_decisions:
  - D083 — Represent the M047 change contract as a pure typed inventory filtered by calibration verdict, with explicit validation for malformed recommendations, missing impacted surfaces, duplicate mechanisms, and contradictory bucket assignments.
  - D084 — Keep the integrated `verify:m046` proof surface separate from the calibration recommendation so the truthful `replace` outcome exits 0 while malformed composition and contradictory contract state still fail non-zero.
patterns_established:
  - Use a pure change-contract helper to derive keep/change/replace inventory from the recommendation plus named runtime seams, rather than hard-coding contract text inside the verifier.
  - For milestone-closeout composition harnesses, evaluate the prerequisite verifier once and inject that exact report into downstream evaluators so nested evidence, counts, and status codes cannot drift.
  - Separate proof-surface health from the domain recommendation so truthful `keep`/`retune`/`replace` outcomes remain machine-readable without conflating a negative recommendation with harness breakage.
observability_surfaces:
  - `bun run verify:m046` human-readable report rendered from the same normalized report object as JSON mode.
  - `bun run verify:m046 -- --json` machine-readable report with stable top-level `M046-S03-*` check IDs, preserved nested S01/S02 reports, top-level verdict, and structured `m047ChangeContract`.
  - Named top-level status codes for preserved nested evidence, retained/excluded count consistency, verdict status, and change-contract completeness.
drill_down_paths:
  - .gsd/milestones/M046/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M046/slices/S03/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-10T23:14:35.818Z
blocker_discovered: false
---

# S03: Explicit Calibration Verdict and M047 Change Contract

**Composed the S01 fixture proof and S02 calibration proof into one `verify:m046` surface that truthfully reports a `replace` verdict and emits a structured M047 keep/change/replace contract.**

## What Happened

S03 closed M046 by adding the last missing proof seam between the already-shipped xbmc fixture evidence and the already-shipped calibration evaluator. First, the slice extracted `src/contributor/calibration-change-contract.ts` as a pure helper that turns the S02 recommendation plus current runtime seams into one deterministic keep/change/replace inventory. That helper validates malformed recommendations, missing impacted surfaces, duplicate mechanisms, and contradictory bucket assignments instead of letting the milestone close on ambiguous contract state. The current checked-in contract keeps the M045 contributor-experience vocabulary, changes the review and Slack consumer surfaces so they can read a future calibrated contract without changing outward guidance semantics, and replaces the live incremental `pr_authored`-only scoring path that currently compresses retained contributors into the newcomer default.

With that seam in place, the slice shipped `scripts/verify-m046.ts` plus `scripts/verify-m046.test.ts` and the canonical `verify:m046` package script. The integrated harness evaluates S01 once, injects that exact prerequisite report into S02 through the existing seam, preserves both nested reports intact, derives a dedicated top-level verdict block, and renders human-readable and `--json` output from the same normalized report object with stable top-level check IDs and status codes. The key closeout behavior is truthful exit semantics: the current domain verdict is `replace`, but the proof harness still exits 0 because the surface is healthy; non-zero is reserved for malformed nested evidence, retained/excluded count drift, missing recommendations, or contradictory M047 contract state.

Fresh verification confirms the integrated surface now delivers the intended end state for M046. `bun run verify:m046` and `bun run verify:m046 -- --json` both pass, preserve the S01 retained/excluded counts (`retained=3`, `excluded=6`), preserve the S02 calibration recommendation and rationale, and emit a concrete `m047ChangeContract` with one keep mechanism (`m045-contributor-experience-contract-vocabulary`), one change mechanism (`stored-tier-consumer-surfaces`), and one replace mechanism (`live-incremental-pr-authored-scoring`). The resulting milestone-closeout truth is explicit: M046 does not certify the current contributor-tier mechanism as sound or merely in need of a threshold retune; it proves the current live incremental scoring path should be replaced in M047 while preserving the M045 contributor-experience vocabulary and re-wiring review/Slack consumers onto the new contract.

## Verification

Fresh slice-level verification passed end to end. `bun test ./scripts/verify-m046.test.ts` passed 5/5 tests and pinned one-shot S01 reuse, top-level verdict wiring, contract contradiction failures, human/JSON alignment, and canonical script wiring. `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts` passed 28/28 tests across the nested fixture, calibration, and integrated proof surfaces. `bun run verify:m046` rendered the human report with `Proof surface: PASS`, `Verdict: replace`, retained/excluded count consistency, and the keep/change/replace contract buckets. `bun run verify:m046 -- --json` returned `overallPassed: true` with stable top-level check IDs plus the preserved nested S01/S02 reports and structured `m047ChangeContract`. `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json` confirmed the nested reports and top-level report agree on counts and recommendation. `bun run tsc --noEmit` passed cleanly.

## Requirements Advanced

- R047 — Added the integrated `verify:m046` operator surface that packages the previously validated fixture and calibration proofs into the final milestone-level keep/retune/replace verdict plus the concrete M047 change contract.

## Requirements Validated

- R047 — `bun test ./scripts/verify-m046.test.ts`, `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts`, `bun run verify:m046`, `bun run verify:m046 -- --json`, `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json`, and `bun run tsc --noEmit` all passed; the integrated report preserved the truthful `replace` recommendation and emitted a concrete `m047ChangeContract`.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

This slice is a proof-and-contract surface only. It intentionally does not change live contributor-scoring behavior, so the integrated report still truthfully ends at `replace` rather than a repaired runtime outcome. The proof remains snapshot-only and inherits S02’s explicit calibration caveats, including `fkoemep`'s stale evidence and the inability to replay changed-file arrays honestly during offline evaluation.

## Follow-ups

Use `bun run verify:m046 [-- --json]` as the canonical milestone-closeout evidence during M046 validation. M047 should preserve the M045 contributor-experience vocabulary, rewire review and Slack consumer surfaces onto the new calibrated contract, and replace the live incremental `pr_authored`-only scoring path with the full-signal calibration model.

## Files Created/Modified

- `src/contributor/calibration-change-contract.ts` — Added the pure typed keep/change/replace contract helper and validation logic for malformed or contradictory contract state.
- `src/contributor/calibration-change-contract.test.ts` — Pinned the current replace inventory, impacted-surface markers, and negative validation paths.
- `src/contributor/index.ts` — Exported the change-contract helper for reuse by the integrated verifier and downstream slices.
- `scripts/verify-m046.ts` — Added the integrated M046 proof harness that composes S01 and S02 once, preserves nested evidence, and emits the top-level verdict plus M047 contract.
- `scripts/verify-m046.test.ts` — Added regression coverage for nested-report preservation, truthful replace exit semantics, contradiction handling, and human/JSON alignment.
- `package.json` — Added the canonical `verify:m046` package script.
