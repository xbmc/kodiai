---
id: S02
parent: M062
milestone: M062
provides:
  - One coherent visible bounded-review rendering contract for downstream milestone proof work.
  - Handler and formatter regression coverage for timeout, retry-merge, and max-turns visible-state publication.
  - A validated implementation of requirement R064's truthful coverage-state surface.
requires:
  - slice: S01
    provides: Normalized bounded first-pass payload and classification contract used as the single visible-state source.
affects:
  - S03
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/lib/partial-review-formatter.ts
  - src/lib/partial-review-formatter.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - .gsd/PROJECT.md
key_decisions:
  - Use normalized `reviewFirstPass` as the single visible-state contract for both public bounded comments and Review Details.
  - Treat timeout progress as additive retry metadata rather than a parallel wording path.
  - Use merged checkpoint evidence as the canonical reviewed total after retry merge.
  - Publish bounded max-turns Review Details through the shared formatter contract instead of branch-local prose.
patterns_established:
  - Single-source visible-state wording in `src/lib/review-utils.ts` for all bounded first-pass surfaces.
  - Truthful degradation when covered or remaining scope is missing: prefer explicit uncertainty over inferred exhaustiveness.
  - Merged checkpoint evidence is canonical after retry merge; retry banners must not add reviewed totals on top of merged scope.
observability_surfaces:
  - `src/lib/review-utils.test.ts` guards Review Details wording and malformed-scope degradation.
  - `src/lib/partial-review-formatter.test.ts` guards public bounded comment wording and parity with Review Details.
  - `src/handlers/review.test.ts` guards timeout publication, retry-merge updates, and bounded max-turns publication through the shared contract.
drill_down_paths:
  - .gsd/milestones/M062/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M062/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M062/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-24T04:46:53.847Z
blocker_discovered: false
---

# S02: S02

**Unified the visible bounded-review contract so public partial comments and Review Details now report the same covered scope, remaining scope, bounded reason, and continuation state across timeout, retry-merge, and max-turns paths.**

## What Happened

S02 closed the wording-drift gap between Kodiai's two visible bounded-review surfaces. The formatter layer in `src/lib/review-utils.ts` now acts as the single contract source for bounded first-pass wording, and `src/lib/partial-review-formatter.ts` consumes that same contract instead of maintaining branch-local prose. Review Details now keeps the shared first-pass coverage story visible even when timeout retry metadata is present, treating timeout/retry state as additive metadata rather than a replacement summary path. In `src/handlers/review.ts`, timeout partial publication, retry-merged updates, and bounded `max_turns` fallback all publish through the same normalized `reviewFirstPass` contract, including Review Details publication for the bounded max-turns branch. The retry-merge fix also corrected a second-order double-counting bug so merged checkpoint coverage is treated as the canonical reviewed total instead of being inflated by retry banner math.

## Verification

Fresh slice-level verification passed after the final code state: `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts` passed 24/24 tests, `bun test ./src/handlers/review.test.ts` passed 135/135 tests, and `bun run tsc --noEmit` completed with exit code 0. These checks explicitly cover bounded timeout publication, malformed-scope degradation, timeout retry parity between public comment and Review Details, retry-merged coverage updates, bounded max-turns Review Details publication, and the compile gate for the touched review surfaces.

## Requirements Advanced

- R064 — Implemented and unified the visible bounded-review contract so both public comments and Review Details report covered scope, remaining scope, and continuation state coherently across constrained publication paths.

## Requirements Validated

- R064 — Fresh verification passed: `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts` (24/24), `bun test ./src/handlers/review.test.ts` (135/135), and `bun run tsc --noEmit` (exit 0).

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

None at slice level. Task T03 extended `src/lib/partial-review-formatter.ts` and its unit coverage after the retry-merge handler change exposed a formatter-level double-counting bug; that follow-on fix was required to keep the visible contract truthful.

## Known Limitations

S02 proves the visible contract through formatter and handler tests, but S03 is still needed to provide a milestone-level deterministic proof harness that locks this behavior against future regression outside the targeted test suites.

## Follow-ups

Build S03's deterministic verifier so operators can prove the unified visible bounded-review contract holds end-to-end before continuation redesign starts.

## Files Created/Modified

- `src/lib/review-utils.ts` — Centralized the bounded first-pass visible-state wording contract used by Review Details and public bounded comments.
- `src/lib/review-utils.test.ts` — Locked Review Details wording, timeout parity, and truthful degradation behavior with formatter-level tests.
- `src/lib/partial-review-formatter.ts` — Switched bounded comment rendering to the shared wording contract and fixed retry-merge double-counting.
- `src/lib/partial-review-formatter.test.ts` — Added parity and regression coverage for bounded comments, timeout wording, and retry-merge totals.
- `src/handlers/review.ts` — Unified timeout, retry-merge, and bounded max-turns publication paths around the shared visible-state contract.
- `src/handlers/review.test.ts` — Added integration coverage for retry-merged Review Details updates and bounded max-turns Review Details publication.
- `.gsd/PROJECT.md` — Refreshed project state to reflect S02 completion and the remaining S03 proof-harness work.
