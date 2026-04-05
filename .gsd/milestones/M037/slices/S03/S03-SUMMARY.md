---
id: S03
parent: M037
milestone: M037
provides:
  - Centralized stale-model policy for cached suggestion-cluster models with four explicit states and a bounded grace window.
  - A staleness-aware, never-throwing review scoring wrapper that preserves truthful degradation reasons and keeps the naive review path intact.
  - A machine-verifiable proof harness covering cache reuse, stale-grace behavior, refresh totals, and naive fail-open fallback.
  - Operational guidance for downstream slices: cluster scoring must load through the staleness-aware resolver, not the strict fresh-only store path.
requires:
  - slice: S01
    provides: Suggestion-cluster storage, TTL-based model cache, refresh substrate, and builder/store contracts that S03 hardens with stale-policy behavior.
  - slice: S02
    provides: Live thematic scoring integration, safety-guarded confidence adjustment, and the review-path insertion point that S03 hardens with fail-open degradation and stale-aware model loading.
affects:
  []
key_files:
  - src/knowledge/suggestion-cluster-staleness.ts
  - src/knowledge/suggestion-cluster-staleness.test.ts
  - src/knowledge/suggestion-cluster-degradation.ts
  - src/knowledge/suggestion-cluster-degradation.test.ts
  - src/handlers/review.ts
  - scripts/verify-m037-s03.ts
  - scripts/verify-m037-s03.test.ts
  - package.json
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Set a bounded 4-hour stale-model grace period beyond the 24-hour TTL so delayed refresh does not immediately discard usable signal, but stale influence stays tightly bounded.
  - Centralized live stale-model handling in `resolveModelForScoring()` and required the review path to use `getModelIncludingStale()` instead of `getModel()` so stale-grace policy cannot drift from runtime behavior.
  - Preserved truthful runtime degradation semantics by carrying a `storeReadFailed` sentinel and keeping `model-load-error` distinct from ordinary `no-model` outcomes.
  - Kept the fail-open wrapper authoritative: every missing dependency, ineligible model, stale-policy miss, or scoring failure returns findings unchanged and never blocks review completion.
patterns_established:
  - Centralize staleness policy in a single resolver module, then route all live callers through it instead of duplicating store/load logic in the review path.
  - Use an exhaustive degradation-reason union for fail-open wrappers so logs, tests, and proof harnesses can distinguish infrastructure failure from expected cache miss states.
  - When a proof harness exposes a runtime-policy mismatch, fix the live path instead of weakening the harness — verifier-driven root-cause correction is the intended closure pattern.
  - For cached ML-ish substrates, bounded stale grace plus explicit observability is preferable to binary fresh/expired behavior because it preserves uptime without hiding degraded state.
observability_surfaces:
  - `resolveModelForScoring()` emits structured logs for fresh, stale-with-warning, very-stale fail-open, missing-model, and store-read-failed outcomes.
  - `applyClusterScoringWithDegradation()` surfaces explicit degradation reasons (`no-store`, `no-embedding`, `model-load-error`, `no-model`, `model-not-eligible`, `scoring-error`) so review-time skips are observable and testable.
  - `verify:m037:s03 -- --json` is the machine-verifiable operational proof surface for this slice; it reports the four closure checks with stable status codes and details.
  - The refresh sweep aggregates built/skipped/failed totals, giving a stable runtime summary surface for bounded background refresh behavior.
drill_down_paths:
  - milestones/M037/slices/S03/tasks/T01-SUMMARY.md
  - milestones/M037/slices/S03/tasks/T02-SUMMARY.md
  - milestones/M037/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T09:43:01.398Z
blocker_discovered: false
---

# S03: Refresh, Staleness Handling, and Fail-Open Verification

**Closed the reinforcement-layer runtime loop with stale-model policy, staleness-aware fail-open scoring, background refresh proof, and a machine-verifiable harness proving cached reuse plus non-blocking fallback.**

## What Happened

S03 hardened the cached suggestion-cluster layer so review-time scoring remains conservative, observable, and non-blocking. T01 introduced `suggestion-cluster-staleness.ts`, which centralizes stale-model policy around a 24-hour TTL plus a 4-hour bounded grace window. Models now classify into four explicit states — `fresh`, `stale`, `very-stale`, and `missing` — and `resolveModelForScoring()` emits structured observability per path. Fresh models load normally, stale models inside the grace window are still used with a warning, and very-stale or missing models degrade to no-scoring. The resolver intentionally uses `getModelIncludingStale()` instead of `getModel()` so expired rows remain visible long enough for grace-period policy enforcement.

T02 extracted the live review fail-open wrapper into `suggestion-cluster-degradation.ts`. `applyClusterScoringWithDegradation()` now consolidates dependency checks, stale-aware model loading, eligibility checks, scoring, and adjustment application into one never-throwing surface with exhaustive reason codes: `no-store`, `no-embedding`, `model-load-error`, `no-model`, `model-not-eligible`, and `scoring-error`. This removed duplicated inline try/catch logic from `review.ts` and made cluster-scoring degradation truthful and machine-checkable. On every skip/error path the function returns findings unchanged, preserves the naive review path, and emits structured logs instead of blocking review completion.

T03 added the slice proof harness (`scripts/verify-m037-s03.ts`) and, while wiring it, exposed a real runtime gap: the live cluster-scoring wrapper was still calling the strict `store.getModel()` path, which bypassed the stale-grace policy added in T01. The fix routed the live wrapper through `resolveModelForScoring()` and added a `storeReadFailed` sentinel so the runtime can still distinguish `model-load-error` from ordinary `no-model`. The harness now proves four slice-closure properties: cached reuse goes through `getModelIncludingStale()` instead of `getModel()`, stale models inside the grace window remain usable, very-stale models fail open to `no-model`, the refresh sweep reports stable built/skipped totals, and missing cluster infrastructure falls back cleanly to the naive scoring path without mutating findings.

Across the slice, the established M037 pattern is now complete: S01 built the cache substrate, S02 wired thematic scoring into review-time findings, and S03 hardened refresh, staleness, and operational degradation so the reinforcement layer never blocks review completion and never claims signal application it did not actually perform.

## Verification

Ran the full slice-level verification contract from the plan and re-verified the assembled behavior after task completion.

1. `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts ./src/knowledge/suggestion-cluster-degradation.test.ts ./scripts/verify-m037-s03.test.ts` → exit 0, 65/65 tests passed. This covers fresh/stale/very-stale/missing model classification, store-read fail-open behavior, stale-grace scoring behavior, degradation reason invariants, and the four proof-harness checks.
2. `bun run verify:m037:s03 -- --json` → exit 0, `overallPassed: true`. Passed checks:
   - `M037-S03-CACHE-REUSE` — `modelUsed=true suppressedCount=1 getModelIncludingStaleCalls=1 getModelCalls=0`
   - `M037-S03-STALE-GRACE-POLICY` — stale model used inside grace window; very-stale model degraded with `veryStaleDegradationReason=no-model`
   - `M037-S03-REFRESH-SWEEP` — `repoCount=2 reposBuilt=1 reposSkipped=1 totalPositiveCentroids=2`
   - `M037-S03-FAIL-OPEN-NAIVE` — `modelUsed=false degradationReason=no-store findingCount=2`
3. `bun run tsc --noEmit` → exit 0.

Observability surfaces were also confirmed indirectly through unit coverage and proof-harness behavior: `resolveModelForScoring()` logs distinct fresh/stale/very-stale/missing/store-read-failed states, and `applyClusterScoringWithDegradation()` preserves structured degradation reasons instead of collapsing them into a generic skip path.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

The slice expanded slightly beyond the planned proof-only work because the new verifier exposed a genuine runtime gap: live scoring still loaded models through `store.getModel()`, which bypassed the stale-grace policy. S03 fixed the root cause by routing the live wrapper through `resolveModelForScoring()` and carrying a `storeReadFailed` sentinel so `model-load-error` and `no-model` remain distinct. This was a necessary correction, not scope creep, because without it the runtime behavior would not have matched the slice contract the verifier was meant to prove.

## Known Limitations

The refresh and proof flows are deterministic and well covered in-process, but they remain code-complete rather than fully ops-proven against a live production DB schedule. The background refresh sweep is still a bounded library/module surface; wiring it into a production scheduler cadence is outside S03. Cluster scoring also still depends on the optional `clusterModelStore` and embedding provider being injected into `createReviewHandler`; when either dependency is absent, the system intentionally degrades to the naive path rather than attempting partial recovery. This is deliberate and verified.

## Follow-ups

When the reinforcement layer is exercised in production, monitor how often models land in the `stale` window versus being refreshed before expiry; that will determine whether the 4-hour grace period and sweep cadence need tuning. If operational pressure appears, add scheduler-level observability around refresh lag and stale-model incidence rather than widening the grace window first. No immediate corrective work is required for M037 itself — S03 delivered the planned closure behavior.

## Files Created/Modified

- `src/knowledge/suggestion-cluster-staleness.ts` — Added centralized stale-model classification, 4-hour grace-period policy, structured resolver output, and observability around fresh/stale/very-stale/missing/store-read-failed paths.
- `src/knowledge/suggestion-cluster-staleness.test.ts` — Added deterministic coverage for all four staleness states, grace-boundary conditions, logger behavior, and resolver fail-open semantics.
- `src/knowledge/suggestion-cluster-degradation.ts` — Extracted the live cluster-scoring fail-open wrapper, routed model loading through the staleness-aware resolver, and preserved exhaustive degradation reason codes.
- `src/knowledge/suggestion-cluster-degradation.test.ts` — Added coverage for stale-but-usable models, very-stale no-model fallback, degradation invariants, and suppression/boost behavior under the new resolver flow.
- `src/handlers/review.ts` — Now consumes the centralized fail-open cluster scoring wrapper instead of duplicated inline try/catch logic, preserving the naive path when scoring is unavailable.
- `scripts/verify-m037-s03.ts` — Added the M037 S03 proof harness with four checks for cache reuse, stale grace, refresh sweep totals, and naive fail-open fallback.
- `scripts/verify-m037-s03.test.ts` — Added verifier regression coverage for pass/fail semantics, output shapes, and all four slice-closure checks.
- `package.json` — Registered the `verify:m037:s03` script so the slice proof harness is runnable as a stable verification contract.
- `.gsd/DECISIONS.md` — Recorded the live-path decision to route degradation through the stale-aware resolver while preserving `model-load-error` versus `no-model` distinction.
- `.gsd/KNOWLEDGE.md` — Captured the non-obvious integration rule that staleness-aware live scoring must use `resolveModelForScoring()` rather than calling `store.getModel()` directly.
- `.gsd/PROJECT.md` — Refreshed project state to reflect M037/S03 completion and the now-complete reinforcement-layer runtime contract.
