---
id: T02
parent: S03
milestone: M037
key_files:
  - src/knowledge/suggestion-cluster-degradation.ts
  - src/knowledge/suggestion-cluster-degradation.test.ts
  - src/handlers/review.ts
key_decisions:
  - Consolidated inline cluster try/catch blocks in review.ts into applyClusterScoringWithDegradation
  - ScoringDegradationReason is an exhaustive string union (6 reasons); null means success
  - Degradation module uses getModel not getModelIncludingStale — staleness policy stays in the staleness module
  - major/correctness and critical/any are suppression-protected — test suppression paths must use non-protected severity/category
duration: 
verification_result: passed
completed_at: 2026-04-05T08:24:29.695Z
blocker_discovered: false
---

# T02: Extracted cluster scoring fail-open logic into suggestion-cluster-degradation.ts with exhaustive ScoringDegradationReason union and 24 passing degradation tests

**Extracted cluster scoring fail-open logic into suggestion-cluster-degradation.ts with exhaustive ScoringDegradationReason union and 24 passing degradation tests**

## What Happened

Created src/knowledge/suggestion-cluster-degradation.ts implementing applyClusterScoringWithDegradation<T> — a generic fail-open wrapper consolidating cluster model load, eligibility check, scoring call, and adjustment application into a single function that never throws. Every skip path returns input findings unchanged with a typed ScoringDegradationReason code (no-store, no-embedding, model-load-error, no-model, model-not-eligible, scoring-error) and emits a structured log entry. Removed two inline try/catch blocks from review.ts and replaced with a single degradation call. Fixed two test issues during development: major/correctness is suppression-protected so suppression tests use medium/style; per-item embedding failures are handled inside scoreFindings returning modelUsed=true, not a scoring-error at this level.

## Verification

bun test ./src/knowledge/suggestion-cluster-degradation.test.ts: 24/24 pass. bun run tsc --noEmit: exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/suggestion-cluster-degradation.test.ts` | 0 | ✅ pass | 200ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 7000ms |

## Deviations

Used getModel (not getModelIncludingStale) in the degradation module's load path — staleness handling belongs in T01's resolveModelForScoring, not duplicated here.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/suggestion-cluster-degradation.ts`
- `src/knowledge/suggestion-cluster-degradation.test.ts`
- `src/handlers/review.ts`
