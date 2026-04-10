---
id: S02
parent: M046
milestone: M046
provides:
  - A shared xbmc snapshot contract (`src/contributor/xbmc-fixture-snapshot.ts`) that keeps retained/excluded contributor truth aligned across proofs.
  - A pure calibration evaluator (`src/contributor/calibration-evaluator.ts`) that compares live incremental behavior with the intended full-signal model and emits an explicit keep/retune/replace recommendation.
  - An operator-facing `verify:m046:s02` proof surface with stable JSON/human report shapes for downstream milestone and rollout slices.
requires:
  - slice: S01
    provides: The checked-in xbmc manifest/snapshot corpus with retained and excluded contributor truth, provenance records, source-availability diagnostics, and the prerequisite `verify:m046:s01` proof surface.
affects:
  - S03
  - M047
key_files:
  - src/contributor/xbmc-fixture-snapshot.ts
  - src/contributor/calibration-evaluator.ts
  - scripts/verify-m046-s01.ts
  - scripts/verify-m046-s02.ts
  - src/contributor/index.ts
  - src/contributor/xbmc-fixture-snapshot.test.ts
  - src/contributor/calibration-evaluator.test.ts
  - scripts/verify-m046-s02.test.ts
  - package.json
  - .gsd/PROJECT.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D079 — Centralize xbmc snapshot loading, validation, and provenance inspection in a shared source module used by both S01 and S02 surfaces.
  - D080 — Model the current live path as linked-but-unscored newcomer guidance unless changed-file replay is available, and model the intended full-signal path from checked-in commit counts plus PR/review provenance using shipped weights.
  - D081 — Gate `verify:m046:s02` on the S01 verifier, preserve retained/excluded truth checks against the manifest, and keep loadable snapshot diagnostics visible even when prerequisite failures suppress the calibration verdict.
patterns_established:
  - Use one authoritative offline snapshot loader to enforce both schema validity and fixture-manifest semantic truth before any downstream evaluation.
  - When snapshot-only calibration cannot honestly replay runtime evidence, model degradation explicitly and report fidelity limits instead of fabricating precision.
  - For percentile-based contributor calibration, separate score/rank instability from contract-state instability so zero-score ties do not get overstated as tier drift.
  - For prerequisite-gated proof harnesses, still surface loadable local-artifact diagnostics while skipping the main verdict until the prerequisite passes.
observability_surfaces:
  - `bun run verify:m046:s02 -- --json` machine-readable report with stable check IDs/status codes, prerequisite state, snapshot counts, per-contributor live/intended projections, and final recommendation.
  - `bun run verify:m046:s02` human-readable report rendered from the same normalized report object.
  - Evaluator findings for live-score compression, divergent contributor IDs, stale contributors, excluded controls, percentile/tie instability, and freshness/unscored-profile caveats.
drill_down_paths:
  - .gsd/milestones/M046/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M046/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M046/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-10T22:15:34.026Z
blocker_discovered: false
---

# S02: Calibration Evaluator for Live vs Intended Model Paths

**Turned the checked-in xbmc contributor fixture pack into a repeatable calibration proof that compares Kodiai’s live incremental path to the intended full-signal model and currently recommends replacement.**

## What Happened

S02 converted the S01 xbmc fixture corpus from static evidence into an operator-facing calibration proof surface. First, the slice extracted `src/contributor/xbmc-fixture-snapshot.ts` as the shared offline loader/validator for `fixtures/contributor-calibration/xbmc-snapshot.json`, so both verifiers and downstream evaluators consume one authoritative retained/excluded snapshot contract with diagnostics and provenance intact instead of duplicating schema logic.

With that seam in place, the slice added `src/contributor/calibration-evaluator.ts` as a pure evaluator over the validated snapshot. The evaluator keeps the modeling honest: it treats the current live path as linked-but-unscored newcomer guidance when historical changed-file replay is unavailable, derives the intended full-signal path from checked-in commit counts plus PR/review provenance using the shipped scoring/tiering helpers, projects both through the M045 contributor-experience contract, reports tie/rank instability separately from contract stability, preserves excluded bot/alias/ambiguous rows as explicit controls, and surfaces freshness/degradation reasons instead of fabricating missing evidence.

Finally, the slice shipped `scripts/verify-m046-s02.ts` and the canonical `verify:m046:s02` package entrypoint. The verifier gates on `verify:m046:s01`, compares retained and excluded truth against the checked-in manifest, still exposes loadable snapshot diagnostics when the prerequisite would fail, and renders human-readable and `--json` output from one normalized report object with stable check IDs and status codes. Against the checked-in xbmc cohort, the current proof shows that the live incremental path collapses all retained contributors into the newcomer default, while the intended full-signal model differentiates `fuzzard` to senior and `KOPRajs` to established; `fkoemep` stays newcomer but carries stale-evidence and missing-review caveats. The resulting slice-level recommendation is `replace`, which gives S03 and M047 a concrete calibration baseline instead of an abstract tuning discussion.

## Verification

Fresh slice-level verification passed end to end. `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts` passed 23/23 tests and covered malformed snapshots, cohort drift, missing recommendations, prerequisite failure handling, and report-shape alignment. `bun run verify:m046:s01 -- --json` passed with retained=3, excluded=6, complete provenance, and alias/source diagnostics intact. `bun run verify:m046:s02 -- --json` passed with all six stable S02 checks green and produced a `replace` recommendation plus per-contributor live/intended diagnostics. `bun run verify:m046:s02` rendered the matching human-readable report. `bun run tsc --noEmit` passed cleanly.

## Requirements Advanced

- R047 — Added the reusable xbmc snapshot loader, pure calibration evaluator, and repeatable `verify:m046:s02` proof surface required to compare live and intended contributor-tier behavior.

## Requirements Validated

- R047 — `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts`, `bun run verify:m046:s01 -- --json`, `bun run verify:m046:s02 -- --json`, and `bun run tsc --noEmit` all passed; the verifier emitted a stable `replace` recommendation with per-contributor live-vs-intended diagnostics.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

This proof surface is deliberately snapshot-only. It does not replay historical webhooks, fabricate changed-file arrays, or hydrate live GitHub data during offline runs. The current report therefore proves divergence between the live incremental path and the intended full-signal model for the checked-in xbmc cohort, but it still carries explicit degradation caveats — especially `fkoemep`'s stale evidence and missing review signal.

## Follow-ups

S03 should compose the S01 fixture proof and S02 calibration proof into one milestone-level keep/retune/replace verdict plus the concrete M047 change contract. M047 should replace or redesign the live incremental-only contributor-calibration path while preserving explicit freshness/degradation reporting in operator surfaces.

## Files Created/Modified

- `src/contributor/xbmc-fixture-snapshot.ts` — Added the shared offline xbmc snapshot loader/validator and manifest-semantic truth checks.
- `src/contributor/calibration-evaluator.ts` — Added the pure calibration evaluator that models live vs intended contributor-profile outcomes with freshness and instability diagnostics.
- `scripts/verify-m046-s01.ts` — Refactored the S01 proof harness to consume the shared snapshot loader instead of private snapshot schemas.
- `scripts/verify-m046-s02.ts` — Added the operator-facing S02 verifier with prerequisite gating, stable check/status codes, and human/JSON report rendering.
- `scripts/verify-m046-s02.test.ts` — Pinned report shape, prerequisite failure behavior, recommendation handling, and human/JSON alignment.
- `package.json` — Added the canonical `verify:m046:s02` package script.
- `.gsd/KNOWLEDGE.md` — Recorded reusable proof-harness and calibration gotchas discovered during S02.
- `.gsd/PROJECT.md` — Refreshed the project state to mark M046/S02 complete and capture the new calibration-proof surfaces.
