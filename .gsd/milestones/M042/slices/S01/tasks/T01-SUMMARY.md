---
id: T01
parent: S01
milestone: M042
key_files:
  - src/contributor/expertise-scorer.ts
  - src/contributor/expertise-scorer.test.ts
  - .gsd/milestones/M042/slices/S01/tasks/T01-SUMMARY.md
key_decisions:
  - Added a scorer-local deriveUpdatedOverallScore helper so regression fixtures can assert the updateTier contract directly without going through the review path or DB integration.
duration: 
verification_result: passed
completed_at: 2026-04-06T22:23:49.462Z
blocker_discovered: false
---

# T01: Added deterministic scorer regressions that prove contributor score updates can increase overallScore while still persisting the stale stored tier.

**Added deterministic scorer regressions that prove contributor score updates can increase overallScore while still persisting the stale stored tier.**

## What Happened

Inspected the contributor scoring path and confirmed the defect is in src/contributor/expertise-scorer.ts: the scorer recalculates overallScore and then persists profile.overallTier unchanged through profileStore.updateTier(...). Added a small scorer-local helper, deriveUpdatedOverallScore, to expose the incremental top-five score calculation through a deterministic seam without involving the review path or DB integration. Expanded src/contributor/expertise-scorer.test.ts with fake-store regressions that capture updateTier arguments, including a general stuck-tier repro and a CrystalP-shaped fixture where a stored newcomer profile gains enough score to rank above the lowest cohort while the persisted tier remains newcomer. Left the stale-tier write behavior intact so this task proves the real defect instead of partially fixing it.

## Verification

Ran bun test ./src/contributor/expertise-scorer.test.ts and confirmed the full scorer test suite passes, including the new deterministic stale-tier regression coverage and the helper-seam assertions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/expertise-scorer.test.ts` | 0 | ✅ pass | 15ms |

## Deviations

None.

## Known Issues

The underlying defect remains in runtime code by design for this task: updateExpertiseIncremental() still persists profile.overallTier instead of recalculating a truthful tier. That fix is expected in T02.

## Files Created/Modified

- `src/contributor/expertise-scorer.ts`
- `src/contributor/expertise-scorer.test.ts`
- `.gsd/milestones/M042/slices/S01/tasks/T01-SUMMARY.md`
