# Quick Task: how can we prevent this from happening? what can we do to prevent 'max turns'?

**Date:** 2026-05-21
**Branch:** fix/production-log-noise

## What Changed
- Auto-reduce high-risk explicit strict reviews instead of skipping timeout scope reduction, so oversized PRs are bounded before they can exhaust max turns.
- Tightened high-risk review prompt file budget from 50 files to 25 files.
- Added a reusable tier cap that limits the combined full-plus-abbreviated prompt surface and moves overflow files to mention-only coverage.
- Recomputed the prompt file list after timeout reduction so the bounded tiers are the files actually sent to the executor.

## Files Modified
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/file-risk-scorer.ts`
- `src/lib/file-risk-scorer.test.ts`
- `src/lib/timeout-estimator.ts`
- `src/lib/timeout-estimator.test.ts`

## Verification
- `bun test src/lib/file-risk-scorer.test.ts src/lib/timeout-estimator.test.ts src/lib/review-boundedness.test.ts src/lib/review-utils.test.ts src/handlers/review.test.ts`
- `bun run lint`
- `bun run verify:m075`
