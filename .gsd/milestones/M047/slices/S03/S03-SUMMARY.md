---
id: S03
parent: M047
milestone: M047
provides:
  - `verify:m047`, the milestone-close coherence verifier that preserves nested S02/M045/M046 evidence and exposes one canonical assembled report.
  - A stable five-scenario milestone matrix proving review/runtime, retrieval, Slack/profile, identity, and contributor-model coherence for linked-unscored, calibrated-retained, stale-degraded, opt-out, and coarse-fallback paths.
  - A hardened false-green contract that fails on malformed nested reports, mapping drift, invalid CLI args, package-script mismatch, leaked opt-out continuity, or fabricated coarse-fallback Slack/profile evidence.
requires:
  - slice: S02
    provides: Downstream stored-profile truth plus the embedded S01 runtime proof surface, trust-aware Slack/profile continuity, retrieval alignment, and opt-out identity suppression evidence.
affects:
  - M047 milestone validation and closeout
key_files:
  - scripts/verify-m047.ts
  - scripts/verify-m047.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
  - .gsd/DECISIONS.md
key_decisions:
  - Compose `verify:m047` only from `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()` so the milestone verifier reuses authoritative upstream evidence instead of re-deriving product logic.
  - Map `coarse-fallback` to S01 cache/runtime plus M045 retrieval evidence and mark Slack/profile continuity `not_applicable` rather than fabricating a linked-profile surface.
  - Treat leaked opt-out linked continuity evidence as a hard milestone-drift failure with explicit `slack_profile_evidence_drift` diagnostics.
patterns_established:
  - Milestone-close verifiers should compose authoritative upstream verifier reports and preserve nested JSON verbatim rather than rebuilding lower-level resolution logic.
  - False-green protection must validate forbidden evidence stays absent, not just that required evidence is present.
  - When a surface does not truthfully exist for a scenario, emit explicit `not_applicable` diagnostics instead of synthesizing fake passing evidence.
observability_surfaces:
  - `bun run verify:m047 -- --json` is the canonical operator-facing coherence report with stable top-level checks and five milestone scenarios.
  - `bun test ./scripts/verify-m047.test.ts` guards scenario mapping, malformed nested reports, invalid args, package wiring, and false-green drift like leaked opt-out continuity.
  - Nested `verify:m047:s02`, `verify:m045:s03`, and `verify:m046` reports remain embedded intact for drill-down instead of being flattened into prose-only output.
drill_down_paths:
  - .gsd/milestones/M047/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M047/slices/S03/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-11T03:18:31.515Z
blocker_discovered: false
---

# S03: Integrated M047 coherence verifier

**Shipped the milestone-close `verify:m047` proof surface that preserves nested S02/M045/M046 evidence, exposes a stable five-scenario coherence matrix, and fails loudly on mapping drift or leaked forbidden evidence.**

## What Happened

S03 closed M047 by adding `scripts/verify-m047.ts` as the single milestone-level inspection surface instead of reopening contributor-resolution product logic. The new harness composes only `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()`, validates their report shapes, preserves their nested JSON verbatim, and emits four stable top-level check IDs plus five operator-facing scenario ids: `linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, and `coarse-fallback`.

The scenario mapping now proves the assembled rollout coherently across the surfaces M047 actually owns. `linked-unscored` stays coarse-fallback without claiming active linked guidance; `calibrated-retained` stays `profile-backed` across runtime and downstream surfaces while the retained calibration anchor comes from `koprajs`; `stale-degraded` stays degraded and anchors contributor-model freshness on `fkoemep`; `opt-out` stays generic and now fails if linked continuity evidence leaks back in; and `coarse-fallback` reuses cache/runtime plus retrieval evidence while marking Slack/profile continuity explicitly `not_applicable` instead of fabricating a linked-profile surface.

Regression coverage in `scripts/verify-m047.test.ts` locked the composition contract. The suite covers happy-path composition, malformed nested reports, missing anchors, invalid CLI args, package script wiring, human/JSON output alignment, and the specific false-green hole where opt-out could regain linked continuity without failing the milestone. That gap is now closed with explicit `slack_profile_evidence_drift` diagnostics, and the relevant verifier gotcha was recorded in project knowledge. Fresh slice-close verification passed for the dedicated regression suite, the real `verify:m047` CLI, the prerequisite proof bundle, and TypeScript compilation, so M047 now has one canonical end-to-end coherence verifier ready for milestone validation and closeout.

## Verification

Fresh slice-close verification passed all required commands:

- `bun test ./scripts/verify-m047.test.ts`
- `bun run verify:m047 -- --json`
- `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

The dedicated verifier suite passed 5 tests with 0 failures. `bun run verify:m047 -- --json` exited 0 and preserved the nested S02, M045, and M046 reports while reporting the expected four top-level checks (`M047-S03-S02-REPORT-COMPOSED`, `M047-S03-M045-REPORT-COMPOSED`, `M047-S03-M046-REPORT-COMPOSED`, `M047-S03-MILESTONE-SCENARIOS`) and the five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`). The prerequisite bundle stayed green, and the embedded M046 `replace` verdict remained machine-readable data rather than a harness failure. `bun run tsc --noEmit` also exited 0.

## Requirements Advanced

- R046 — Preserved the M045 contributor-experience contract as the shared truth source inside the milestone-close verifier instead of reintroducing raw-tier or surface-specific drift.
- R048 — Added the integrated `verify:m047` proof surface that assembles review/runtime, retrieval, Slack/profile, identity, and contributor-model evidence into one coherent milestone report.

## Requirements Validated

- R046 — `bun run verify:m047 -- --json` and the prerequisite bundle (`bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`) passed, proving the M045 contract remains truthful across review prompt/Review Details, retrieval hints, Slack/profile output, identity suppression, and calibration evidence.
- R048 — Fresh slice-close verification passed `bun test ./scripts/verify-m047.test.ts`, `bun run verify:m047 -- --json`, the prerequisite verifier bundle, and `bun run tsc --noEmit`, while the integrated report preserved nested S02/M045/M046 evidence and the five milestone scenarios.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

- None. — 

## Deviations

None.

## Known Limitations

None within slice scope. The embedded M046 `replace` recommendation remains intentional machine-readable evidence, not a verifier failure.

## Follow-ups

Use `verify:m047` as the canonical proof surface during milestone validation/closeout. If future contributor-resolution work changes any in-scope surface, extend this verifier’s scenario matrix instead of creating a parallel proof path.

## Files Created/Modified

- `scripts/verify-m047.ts` — Added the milestone-level composition harness, stable scenario mapping, nested-report validation, explicit `not_applicable` handling, and opt-out continuity drift failure logic.
- `scripts/verify-m047.test.ts` — Added regression coverage for happy-path composition, malformed nested reports, missing anchors, invalid args, package wiring, human/JSON alignment, and leaked opt-out continuity.
- `package.json` — Wired the canonical `verify:m047` package script for operator and slice-close verification.
- `.gsd/KNOWLEDGE.md` — Captured the M047/S03 gotcha that forbidden opt-out continuity evidence must fail the milestone verifier instead of being ignored.
- `.gsd/DECISIONS.md` — Recorded the S03 verification decisions covering verifier composition, coarse-fallback not-applicable handling, and opt-out continuity drift failure policy.
