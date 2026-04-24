# M065 Summary — Verification Failed

**Status:** Not complete
**Milestone:** M065 — Live hardening and rollout proof
**Generated:** 2026-04-24T16:40:30Z

## Result

Milestone M065 verification FAILED — not complete.

## Verification Failures

### 1. Code change verification failed
- Command: `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'`
- Result: no non-`.gsd/` diff entries were returned in this verification run.
- Why this blocks completion: the completion gate requires verified code changes outside planning/state artifacts.

### 2. Success criteria verification failed
- Criterion not met: **"One safe but representative live large-PR proof demonstrates the redesigned lifecycle on a real path rather than only in deterministic fixtures."**
- Evidence: `bun run verify:m065 -- --json` failed with `status_code: "m065_nested_verifier_failed"` because `M065-LIVE-LARGE-PR-PROOF` failed.
- Drill-down from `nested_reports.s02`:
  - `M065-S02-RUNTIME-TIMING-EVIDENCE` failed with `m048_s01_no_matching_phase_timing`
  - `M065-S02-VISIBLE-REVIEW-PROOF` failed with `m049_s02_github_unavailable`
  - `M065-S02-REPRESENTATIVE-LIVE-BUNDLE` failed because the representative live bundle was insufficient
- Concrete blocker details:
  - No correlated `Review phase timing summary` rows were found for the representative `reviewOutputKey`
  - GitHub review artifact collection returned 403 / unavailable for PR #101
  - Canonical operator evidence degraded to `lookup-unavailable` because Postgres lookup timed out

## Definition of Done Checks

### Passed
- All roadmap slices are complete in milestone state:
  - S01: complete
  - S02: complete
  - S03: complete
- All slice summaries exist:
  - `.gsd/milestones/M065/slices/S01/S01-SUMMARY.md`
  - `.gsd/milestones/M065/slices/S02/S02-SUMMARY.md`
  - `.gsd/milestones/M065/slices/S03/S03-SUMMARY.md`
- Fresh regression proof is satisfied via `nested_reports.s03`

### Failed
- Cross-slice integrated milestone verifier does **not** pass end-to-end because the live large-PR proof contract remains red at the composed `verify:m065` surface.

## What The Next Attempt Needs To Fix
- Provide a real representative large-PR sample whose runtime timing evidence is present and queryable by `verify:m048:s01`
- Restore GitHub artifact access so `verify:m049:s02` can resolve visible review proof without 403 failure
- Ensure canonical operator evidence for the representative sample is available so S02 does not degrade to `lookup-unavailable`
- Re-run `bun run verify:m065 -- --json` and confirm `M065-LIVE-LARGE-PR-PROOF` passes before attempting milestone completion

## Commands Run
- `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'`
- `find .gsd/milestones/M065/slices -maxdepth 2 -name 'S*-SUMMARY.md' | sort`
- `bun run verify:m065 -- --json`
- `gsd_milestone_status("M065")`

## Notes
- Per the completion gate, verification tool failure or non-green verifier output is itself a blocking verification failure.
- `gsd_complete_milestone` was intentionally **not** called.
- `.gsd/PROJECT.md` and `.gsd/REQUIREMENTS.md` were intentionally **not** updated for completion.
