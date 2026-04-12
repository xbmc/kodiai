---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T03: Rerun the live recent-sample audit with Azure evidence in the loop

Rerun the live recent-review audit against xbmc/xbmc after the Azure resolver is wired in. Capture the updated sample verdicts, confirm at least one case now resolves beyond `indeterminate`, and record any still-missing evidence precisely for S03 packaging. Do not create outward GitHub actions; use the existing recent sample and live internal evidence only.

## Inputs

- `scripts/verify-m044-s01.ts`
- `src/review-audit/log-analytics.ts`
- `src/review-audit/evidence-correlation.ts`
- `.gsd/milestones/M044/slices/S01/S01-SUMMARY.md`

## Expected Output

- `scripts/verify-m044-s01.ts`

## Verification

bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json

## Observability Impact

Produces a second live audit report that proves the repaired evidence path against current production history rather than only against fixtures.
