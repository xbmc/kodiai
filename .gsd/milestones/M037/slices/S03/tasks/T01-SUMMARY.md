---
id: T01
parent: S03
milestone: M037
key_files:
  - src/knowledge/suggestion-cluster-staleness.ts
  - src/knowledge/suggestion-cluster-staleness.test.ts
key_decisions:
  - Grace period set to 4 hours: enough buffer for delayed refresh while bounding stale signal age
  - resolveModelForScoring uses getModelIncludingStale (not getModel) so stale rows remain visible for grace-period logic
  - nowMs injectable on both pure and async functions for deterministic tests without real clock dependency
duration: 
verification_result: passed
completed_at: 2026-04-05T08:11:56.485Z
blocker_discovered: false
---

# T01: Added suggestion-cluster-staleness module with 4-hour grace-period policy, four staleness states, structured observability signals, and 22 passing tests

**Added suggestion-cluster-staleness module with 4-hour grace-period policy, four staleness states, structured observability signals, and 22 passing tests**

## What Happened

Created src/knowledge/suggestion-cluster-staleness.ts implementing a bounded stale-model policy for the cluster scoring pipeline. The module classifies cached model rows into fresh / stale / very-stale / missing states. Stale models (expired but within the 4-hour grace window) are returned for scoring with a structured warn log. Very-stale and missing models degrade to null, triggering fail-open no-scoring behavior. The resolver uses getModelIncludingStale so expired rows remain visible for grace-period handling. Both evaluateModelStaleness (pure) and resolveModelForScoring (async) accept a nowMs override for deterministic testing. 22 tests pass covering all paths, boundary conditions (at/±1ms of grace period), store error fallback, and logger binding assertions.

## Verification

bun test ./src/knowledge/suggestion-cluster-staleness.test.ts: 22/22 pass. bun run tsc --noEmit: exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts` | 0 | ✅ pass | 1600ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6900ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/suggestion-cluster-staleness.ts`
- `src/knowledge/suggestion-cluster-staleness.test.ts`
