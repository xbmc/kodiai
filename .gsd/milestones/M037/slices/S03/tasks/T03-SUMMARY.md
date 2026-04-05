---
id: T03
parent: S03
milestone: M037
key_files:
  - scripts/verify-m037-s03.ts
  - scripts/verify-m037-s03.test.ts
  - src/knowledge/suggestion-cluster-degradation.ts
  - src/knowledge/suggestion-cluster-staleness.ts
  - src/knowledge/suggestion-cluster-degradation.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Use resolveModelForScoring in the live cluster-scoring wrapper so stale cached models within the grace window remain usable in review scoring
  - Preserve model-load-error versus no-model degradation reasons by carrying a storeReadFailed sentinel on the resolver result instead of collapsing all null-model outcomes
duration: 
verification_result: passed
completed_at: 2026-04-05T08:51:11.096Z
blocker_discovered: false
---

# T03: Added the M037 S03 proof harness and wired live cluster scoring through the stale-model resolver so cache reuse, stale-grace handling, refresh, and naive fail-open fallback are executable and verified.

**Added the M037 S03 proof harness and wired live cluster scoring through the stale-model resolver so cache reuse, stale-grace handling, refresh, and naive fail-open fallback are executable and verified.**

## What Happened

Built scripts/verify-m037-s03.ts and scripts/verify-m037-s03.test.ts to prove four closure properties for this slice: cached model reuse, stale-grace policy behavior, refresh sweep totals, and naive fail-open review fallback. While implementing the proof, I found the live cluster-scoring wrapper still loaded models through store.getModel(), which bypassed the stale-model grace policy introduced earlier in the slice. I fixed that by routing applyClusterScoringWithDegradation through resolveModelForScoring and adding a storeReadFailed sentinel to preserve the higher-level model-load-error versus no-model degradation reasons. I updated degradation unit tests to cover stale-but-usable cached models and very-stale fail-open behavior, added the verify:m037:s03 package script, and recorded the integration rule in .gsd/KNOWLEDGE.md.

## Verification

Verified the runtime modules and the new proof harness. bun test ./src/knowledge/suggestion-cluster-staleness.test.ts passed after the resolver shape change. bun test ./src/knowledge/suggestion-cluster-degradation.test.ts passed with the new staleness-aware loading behavior. bun test ./scripts/verify-m037-s03.test.ts passed. bun run verify:m037:s03 -- --json reported all four S03 proof checks passing. bun run tsc --noEmit exited 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts` | 0 | ✅ pass | 23ms |
| 2 | `bun test ./src/knowledge/suggestion-cluster-degradation.test.ts` | 0 | ✅ pass | 211ms |
| 3 | `bun test ./scripts/verify-m037-s03.test.ts` | 0 | ✅ pass | 218ms |
| 4 | `bun run verify:m037:s03 -- --json` | 0 | ✅ pass | 155ms |
| 5 | `bun run tsc --noEmit` | 0 | ✅ pass | 6741ms |

## Deviations

Expanded beyond the planned proof files to fix the live runtime gap the proof exposed: applyClusterScoringWithDegradation now uses the staleness-aware resolver, and the existing degradation tests plus package script were updated accordingly.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m037-s03.ts`
- `scripts/verify-m037-s03.test.ts`
- `src/knowledge/suggestion-cluster-degradation.ts`
- `src/knowledge/suggestion-cluster-staleness.ts`
- `src/knowledge/suggestion-cluster-degradation.test.ts`
- `package.json`
- `.gsd/KNOWLEDGE.md`
