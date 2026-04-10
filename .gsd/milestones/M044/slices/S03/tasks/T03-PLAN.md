---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T03: Run the packaged verifier live and close the milestone on the final report

Run the final milestone-level verifier through the packaged surface, confirm the recent xbmc/xbmc sample still resolves with real internal evidence, and close M044 on the observed final report. If the live run regresses, stop and record the exact blocker instead of papering over it.

## Inputs

- `scripts/verify-m044-s01.ts`
- `docs/runbooks/recent-review-audit.md`
- `.gsd/milestones/M044/slices/S02/S02-SUMMARY.md`

## Expected Output

- `scripts/verify-m044-s01.ts`

## Verification

bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json

## Observability Impact

Produces the final operator-grade report and proves the milestone closes on the same surface the runbook describes.
