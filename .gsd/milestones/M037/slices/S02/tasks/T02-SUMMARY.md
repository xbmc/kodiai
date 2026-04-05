---
id: T02
parent: S02
milestone: M037
key_files:
  - src/feedback/confidence-adjuster.ts
  - src/feedback/confidence-adjuster.test.ts
  - src/handlers/review.ts
  - src/feedback/index.ts
key_decisions:
  - Cluster scoring runs AFTER processedFindings map so boost applies to feedback-adjusted confidence, not raw base
  - applyClusterScoreAdjustment centralized in confidence-adjuster.ts alongside feedback adjustment path
  - Already-suppressed findings skip cluster scoring — cluster cannot unsuppress
  - gate=cluster-scoring structured log with clusterSuppressedCount and clusterBoostedCount for ops observability
duration: 
verification_result: passed
completed_at: 2026-04-05T07:59:21.829Z
blocker_discovered: false
---

# T02: Wired scoreFindings() into review pipeline; centralized applyClusterScoreAdjustment() in confidence-adjuster.ts; 22 tests pass

**Wired scoreFindings() into review pipeline; centralized applyClusterScoreAdjustment() in confidence-adjuster.ts; 22 tests pass**

## What Happened

Added applyClusterScoreAdjustment() to confidence-adjuster.ts as the merge point for cluster-derived suppression and confidence signals. The function enforces the safety guard (CRITICAL/MAJOR security bypass) and handles the fail-open (clusterModelUsed=false) path. Wired clusterModelStore as an optional dep in createReviewHandler: loads the cluster model fail-open after evaluateFeedbackSuppressions, runs scoreFindings() after the initial processedFindings map (so boost applies to feedback-adjusted confidence), and applies applyClusterScoreAdjustment per-finding. Already-suppressed findings skip the cluster pass. Added structured log gates for model load (debug) and scoring outcomes (info with suppressed/boosted counts). Re-exported applyClusterScoreAdjustment from feedback/index.ts. 10 new tests cover CRITICAL bypass, MAJOR security bypass, lower-severity suppression, confidence boost, fail-open, no-op when confidence unchanged, boost-wins-over-lower, suppression-before-boost, and clamping.

## Verification

bun test ./src/feedback/confidence-adjuster.test.ts — 22/22 pass (10ms). bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/feedback/confidence-adjuster.test.ts` | 0 | ✅ pass | 10ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6800ms |

## Deviations

Cluster scoring applied after initial processedFindings map so boost applies to feedback-adjusted confidence. Plan was silent on ordering; this is the correct sequence.

## Known Issues

None.

## Files Created/Modified

- `src/feedback/confidence-adjuster.ts`
- `src/feedback/confidence-adjuster.test.ts`
- `src/handlers/review.ts`
- `src/feedback/index.ts`
