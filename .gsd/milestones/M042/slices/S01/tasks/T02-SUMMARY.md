---
id: T02
parent: S01
milestone: M042
key_files:
  - src/contributor/expertise-scorer.ts
  - src/contributor/expertise-scorer.test.ts
  - src/contributor/tier-calculator.ts
  - src/contributor/tier-calculator.test.ts
  - .gsd/milestones/M042/slices/S01/tasks/T02-SUMMARY.md
key_decisions:
  - Extracted canonical percentile helpers into tier-calculator and wrapped scorer-side recalculation in a fail-open seam so shared tier logic stays centralized without blocking review-time background updates on snapshot-read failures.
duration: 
verification_result: passed
completed_at: 2026-04-06T22:29:11.153Z
blocker_discovered: false
---

# T02: Wired percentile tier recalculation into contributor score updates with fail-open fallback.

**Wired percentile tier recalculation into contributor score updates with fail-open fallback.**

## What Happened

Extracted shared percentile helpers in src/contributor/tier-calculator.ts and routed both computeExpertiseScores() and updateExpertiseIncremental() through a scorer-local recalculateTierFailOpen() seam in src/contributor/expertise-scorer.ts. Score updates now persist a recalculated tier derived from the current score distribution instead of reusing profile.overallTier, while snapshot-read failures log a warning and fall back to the stored tier so background review-time updates remain non-blocking. Updated the scorer and tier-calculator tests to prove truthful tier advancement and the degraded fallback path.

## Verification

Ran the task verification gate exactly as planned: bun test ./src/contributor/expertise-scorer.test.ts && bun test ./src/contributor/tier-calculator.test.ts. Both suites passed, covering shared percentile assignment helpers, scorer-side tier advancement under the CrystalP-shaped distribution, and fail-open fallback when score snapshot reads fail.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/expertise-scorer.test.ts && bun test ./src/contributor/tier-calculator.test.ts` | 0 | ✅ pass | 5000ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/contributor/expertise-scorer.ts`
- `src/contributor/expertise-scorer.test.ts`
- `src/contributor/tier-calculator.ts`
- `src/contributor/tier-calculator.test.ts`
- `.gsd/milestones/M042/slices/S01/tasks/T02-SUMMARY.md`
