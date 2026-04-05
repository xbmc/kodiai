# S03: Refresh, Staleness Handling, and Fail-Open Verification — UAT

**Milestone:** M037
**Written:** 2026-04-05T09:43:01.398Z

# S03: Refresh, Staleness Handling, and Fail-Open Verification — UAT

## Preconditions

- Repository is on the M037 branch state with S01, S02, and S03 code present.
- Bun dependencies are installed.
- No live database or embedding API is required for the scripted proof cases; the verifier uses deterministic in-process fixtures.
- Optional: a logger sink is available if you want to inspect structured stale/degradation events manually.

## UAT 1 — Stale-model policy classifies all four states correctly

1. Run `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts`.
2. Confirm the following expectations are covered and pass:
   - `missing` when no model row exists
   - `fresh` when `expiresAt` is in the future
   - `stale` when the model is just past expiry and still within the 4-hour grace window
   - `very-stale` when the model is beyond the grace window
3. Inspect the boundary-case test names and confirm exact-edge coverage exists for:
   - 1ms past expiry
   - exactly at the grace-period boundary
   - 1ms beyond the grace period

**Expected outcome:** All tests pass. The grace-window contract is explicit and deterministic at the exact time boundaries.

## UAT 2 — Stale cached models remain usable inside the grace window

1. Run `bun run verify:m037:s03 -- --json`.
2. Find the check with `id = "M037-S03-STALE-GRACE-POLICY"`.
3. Confirm:
   - `passed` is `true`
   - `status_code` is `stale_window_respected`
   - `detail` reports a `stale=` description and a `veryStale=` description
4. Confirm the detail string shows the stale model path was still used and the very-stale path degraded with `veryStaleDegradationReason=no-model`.

**Expected outcome:** Models just beyond expiry are still usable within the grace window, but models beyond that window are not used for scoring.

## UAT 3 — Live scoring reuses cached models through the stale-aware loader, not the strict fresh-only path

1. Run `bun run verify:m037:s03 -- --json`.
2. Find the check with `id = "M037-S03-CACHE-REUSE"`.
3. Confirm:
   - `passed` is `true`
   - `status_code` is `cached_model_reused_via_staleness_loader`
   - `detail` contains `getModelIncludingStaleCalls=1`
   - `detail` contains `getModelCalls=0`
   - `detail` contains `modelUsed=true`

**Expected outcome:** The proof shows the live review wrapper uses the stale-aware loading path and does not bypass policy with the strict `getModel()` path.

## UAT 4 — Background refresh sweep reports stable built/skipped totals

1. Run `bun run verify:m037:s03 -- --json`.
2. Find the check with `id = "M037-S03-REFRESH-SWEEP"`.
3. Confirm:
   - `passed` is `true`
   - `status_code` is `refresh_processed_expired_repos`
   - `detail` contains `repoCount=2`
   - `detail` contains `reposBuilt=1`
   - `detail` contains `reposSkipped=1`
   - `detail` contains `totalPositiveCentroids=2`

**Expected outcome:** The bounded refresh sweep is executable and produces stable aggregate totals suitable for machine verification.

## UAT 5 — Missing cluster infrastructure fails open to the naive review path

1. Run `bun run verify:m037:s03 -- --json`.
2. Find the check with `id = "M037-S03-FAIL-OPEN-NAIVE"`.
3. Confirm:
   - `passed` is `true`
   - `status_code` is `review_fell_back_to_naive_path`
   - `detail` contains `modelUsed=false`
   - `detail` contains `degradationReason=no-store`
4. Run `bun test ./src/knowledge/suggestion-cluster-degradation.test.ts`.
5. Confirm the degradation tests cover no-store, no-embedding, model-load-error, no-model, model-not-eligible, and scoring-error paths.

**Expected outcome:** If the cluster layer is absent or unavailable, review scoring completes with unchanged findings and a truthful degradation reason instead of throwing or pretending cluster signal was applied.

## UAT 6 — Very-stale models do not silently influence review findings

1. Run `bun test ./src/knowledge/suggestion-cluster-degradation.test.ts`.
2. Confirm the test named for the no-model path when the cached model is beyond the stale grace window passes.
3. Confirm the stale-grace path test also passes for stale-but-still-usable models.

**Expected outcome:** The system distinguishes stale-but-usable and too-stale-to-use behavior instead of treating all expired rows the same.

## UAT 7 — TypeScript and slice-wide verification contract remain clean

1. Run:
   - `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts ./src/knowledge/suggestion-cluster-degradation.test.ts ./scripts/verify-m037-s03.test.ts`
   - `bun run verify:m037:s03 -- --json`
   - `bun run tsc --noEmit`
2. Confirm every command exits 0.

**Expected outcome:** The slice is closed only when module tests, proof harness, and repository typecheck all pass together.

## Edge Cases to Exercise Explicitly

### Edge Case A — Exact grace-boundary behavior

1. Run `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts`.
2. Confirm the exact-boundary test (`expiredBy === grace`) passes as `stale`, not `very-stale`.

**Expected:** At exactly the grace limit, the model is still considered usable.

### Edge Case B — 1ms beyond grace window

1. Run `bun test ./src/knowledge/suggestion-cluster-staleness.test.ts`.
2. Confirm the test for `1ms beyond grace period` passes as `very-stale`.

**Expected:** The policy cutoff is strict and deterministic immediately beyond the grace window.

### Edge Case C — Store read failure preserves truthful reason code

1. Run `bun test ./src/knowledge/suggestion-cluster-degradation.test.ts`.
2. Confirm the `model-load-error` tests pass when the store throws.
3. Confirm the function resolves rather than throwing.

**Expected:** Infrastructure failure is reported as `model-load-error`, not collapsed into `no-model`, and the review path still fails open.

## Operational Readiness

- **Health signal:** `verify:m037:s03` passes all four checks; logs distinguish fresh, stale-use, very-stale fail-open, and explicit degradation reasons.
- **Failure signal:** Rising `stale`/`very-stale` incidence, repeated `model-load-error` events, or refresh summaries with growing skipped/failed totals indicate cache freshness or store-health drift.
- **Recovery procedure:** Re-run the bounded refresh sweep / proof harness, inspect whether models are being loaded through `getModelIncludingStale`, and restore store/embedding dependencies if degradation reasons shift from expected `no-model` to repeated `model-load-error` or `scoring-error`.
- **Monitoring gaps:** S03 proves code-complete behavior in-process, but does not add scheduler-level production metrics for refresh lag frequency; that should be added only if live stale incidence becomes operationally significant.
