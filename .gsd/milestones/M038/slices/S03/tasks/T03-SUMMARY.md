---
id: T03
parent: S03
milestone: M038
key_files:
  - scripts/verify-m038-s03.ts
  - scripts/verify-m038-s03.test.ts
  - package.json
key_decisions:
  - Each check is independently exported so tests can assert pass/fail per check without running the full harness.
  - The timeout check uses a 40ms cutoff against 500ms slow adapters and asserts elapsed < 400ms for generous CI margin.
  - The partial degradation check covers both asymmetric failure orientations (graph-ok+corpus-fail and graph-fail+corpus-ok) in a single check.
duration: 
verification_result: passed
completed_at: 2026-04-05T21:08:07.942Z
blocker_discovered: false
---

# T03: Added milestone-level verifier proving cache reuse, timeout fail-open, substrate failure truthfulness, and partial degradation correctness for the structural-impact consumer path

**Added milestone-level verifier proving cache reuse, timeout fail-open, substrate failure truthfulness, and partial degradation correctness for the structural-impact consumer path**

## What Happened

Implemented scripts/verify-m038-s03.ts as a self-contained in-process proof harness with four independent checks. (1) M038-S03-CACHE-REUSE instruments fetchStructuralImpact with call-counting adapters to confirm the first call triggers cache-miss+cache-write and the second call hits the cache without invoking broken replacement adapters. (2) M038-S03-TIMEOUT-FAIL-OPEN runs both adapters at 500ms latency with a 40ms timeout, confirms status unavailable + two timeout degradation records + both timeout signals, and asserts the call completes in under 400ms with no invented callers or evidence. (3) M038-S03-SUBSTRATE-FAILURE-TRUTHFUL has both adapters throw, then verifies status unavailable, graphStats null, empty evidence/callers/tests, and the degradation summary's truthfulnessSignals contain graph-unavailable+corpus-unavailable+no-structural-evidence. (4) M038-S03-PARTIAL-DEGRADATION-TRUTHFUL covers both asymmetric directions: graph-ok+corpus-fail shows only graph evidence with a corpus degradation record, and graph-fail+corpus-ok shows only corpus evidence with a graph degradation record. Added verify-m038-s03.test.ts with 11 tests and registered the verify:m038:s03 npm script.

## Verification

Ran `bun test ./scripts/verify-m038-s03.test.ts && bun run verify:m038:s03 -- --json` as specified in the slice plan. 11/11 tests passed, all 4 checks passed with stable status codes (cache_reuse_verified, timeout_fail_open_verified, substrate_failure_truthful_verified, partial_degradation_truthful_verified), JSON output round-trips cleanly, and bun run tsc --noEmit exits 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m038-s03.test.ts` | 0 | ✅ pass | 245ms |
| 2 | `bun run verify:m038:s03 -- --json` | 0 | ✅ pass | 80ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 1000ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m038-s03.ts`
- `scripts/verify-m038-s03.test.ts`
- `package.json`
