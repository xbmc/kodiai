---
id: T02
parent: S03
milestone: M047
key_files:
  - scripts/verify-m047.ts
  - scripts/verify-m047.test.ts
  - .gsd/KNOWLEDGE.md
  - .gsd/milestones/M047/slices/S03/tasks/T02-SUMMARY.md
key_decisions:
  - Treat opt-out linked-continuity evidence as a hard milestone-drift failure instead of ignoring it in the composed Slack/profile check.
duration: 
verification_result: passed
completed_at: 2026-04-11T03:13:11.448Z
blocker_discovered: false
---

# T02: Closed the `verify:m047` opt-out continuity false-green hole and locked it with drift-focused regression coverage.

**Closed the `verify:m047` opt-out continuity false-green hole and locked it with drift-focused regression coverage.**

## What Happened

Started from the existing integrated verifier/test surface and looked for the remaining false-green seam instead of broadening the harness blindly. The concrete gap was in the composed Slack/profile check: `buildSlackProfileEvidence(...)` required linked continuity when it should exist, but it did not fail when the opt-out scenario unexpectedly regained linked-continuity evidence. I added a regression to `scripts/verify-m047.test.ts` that injects contradictory opt-out continuity into the real nested S02/M045/M046 reports, watched the suite fail with exitCode 0 instead of 1, then tightened `scripts/verify-m047.ts` so opt-out Slack/profile evidence now reports `slack_profile_evidence_drift` when linked continuity appears where it should be absent. I also appended the gotcha to `.gsd/KNOWLEDGE.md` so future verifier work validates forbidden evidence as well as required evidence.

## Verification

Verified the red-green regression with `bun test ./scripts/verify-m047.test.ts`, then reran the full slice-close bundle: `bun run verify:m047 -- --json`, `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`, and `bun run tsc --noEmit`. All commands exited 0 after the harness change, and the milestone JSON report still preserved the nested S02/M045/M046 evidence plus the expected five milestone scenarios.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m047.test.ts` | 0 | ✅ pass | 470ms |
| 2 | `bun run verify:m047 -- --json` | 0 | ✅ pass | 430ms |
| 3 | `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json` | 0 | ✅ pass | 480ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 10640ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m047.ts`
- `scripts/verify-m047.test.ts`
- `.gsd/KNOWLEDGE.md`
- `.gsd/milestones/M047/slices/S03/tasks/T02-SUMMARY.md`
