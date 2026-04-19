---
id: T02
parent: S03
milestone: M051
key_files:
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s01.test.ts
  - scripts/verify-m048-s03.test.ts
key_decisions:
  - Reserve `no correlated phase evidence available` for the true missing-evidence path and treat `published: null` as `publication unknown` in verifier summaries.
  - Pin `verify:m048:s03` to the shared S01 `outcome.summary` text so downstream operator wording cannot drift independently.
duration: 
verification_result: mixed
completed_at: 2026-04-19T00:47:24.908Z
blocker_discovered: false
---

# T02: Repaired M048 verifier summaries so incomplete evidence and publication-unknown states stay truthful across the S01 and S03 report surfaces.

**Repaired M048 verifier summaries so incomplete evidence and publication-unknown states stay truthful across the S01 and S03 report surfaces.**

## What Happened

I followed a red-green cycle for the verifier wording drift. First I extended `scripts/verify-m048-s01.test.ts` with failing regressions for three cases the old implementation collapsed incorrectly: evidence present with `conclusion: null`/`published: null`, `success` with `published: null`, and `timeout` with `published: null`. I also extended `scripts/verify-m048-s03.test.ts` so the live S03 report path pins the reused S01 `outcome.summary` string verbatim.

With the failures reproduced, I updated `deriveM048S01Outcome()` in `scripts/verify-m048-s01.ts` to reserve `no correlated phase evidence available` for the true `!evidence` path only, keep `timeout_partial` limited to timeout evidence that explicitly published output, and render `publication unknown` whenever `published === null`. The fallback branch now reports `unknown (...)` for incomplete-but-present evidence instead of pretending no evidence existed.

This keeps the operator-facing summary truthful in both the direct S01 verifier surface and the downstream S03 live report that exposes `report.live.phaseTiming.outcome.summary`.

## Verification

Task verification passed: `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts` and the downstream guard `bun test ./scripts/verify-m048-s02.test.ts` both succeeded after the fix. Observability impact was verified directly by asserting the repaired S01 `outcome.summary` strings and the unchanged S03 reuse path in tests.

Slice-level verification status for this intermediate task: `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts`, `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`, and `bun run tsc --noEmit` all passed. The runbook grep check still fails because `docs/runbooks/review-requested-debug.md` still contains the stale `## M050 Timeout-Truth Verifier Surfaces` header, which is the remaining T03 docs work for this slice rather than a regression from T02.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts` | 0 | ✅ pass | 88ms |
| 2 | `bun test ./scripts/verify-m048-s02.test.ts` | 0 | ✅ pass | 24ms |
| 3 | `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts` | 0 | ✅ pass | 91ms |
| 4 | `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 4551ms |
| 5 | `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md` | 1 | ❌ fail | 3ms |
| 6 | `bun run tsc --noEmit` | 0 | ✅ pass | 8400ms |

## Deviations

None.

## Known Issues

Slice-level docs verification is still red until T03 updates `docs/runbooks/review-requested-debug.md` to remove the stale `## M050 Timeout-Truth Verifier Surfaces` header.

## Files Created/Modified

- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s01.test.ts`
- `scripts/verify-m048-s03.test.ts`
