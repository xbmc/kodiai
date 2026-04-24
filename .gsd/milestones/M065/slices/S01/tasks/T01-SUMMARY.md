---
id: T01
parent: S01
milestone: M065
key_files:
  - scripts/verify-m065.test.ts
key_decisions:
  - Used Bun `mock.module()` to stub `verify-m062-s03`, `verify-m063-s03`, and `verify-m064-s03` so M065 must treat nested reports as authoritative payloads rather than deriving new conclusions.
duration: 
verification_result: passed
completed_at: 2026-04-24T08:30:23.650Z
blocker_discovered: false
---

# T01: Added failing M065 composition-contract tests that pin nested verifier preservation, stable check IDs, human drill-down wording, and package script wiring.

**Added failing M065 composition-contract tests that pin nested verifier preservation, stable check IDs, human drill-down wording, and package script wiring.**

## What Happened

I inspected the existing M046, M062 S03, M063 S03, and M064 S03 verifier/report patterns plus their test suites, then authored `scripts/verify-m065.test.ts` as a full contract suite for the new composed verifier. The tests use Bun `mock.module()` seams to stub the M062/M063/M064 evaluators so the future M065 harness must preserve those nested reports as authoritative payloads instead of recomputing their conclusions. The suite pins the top-level M065 check IDs, JSON report shape, explicit pending rollout obligations for live proof and fresh regression proof, malformed nested-report handling, nested failure propagation, human-readable drill-down wording, and `package.json` script wiring. I stopped at the red phase on purpose: the new suite currently fails because `scripts/verify-m065.ts` and the `verify:m065` package script do not exist yet, which is the intended pre-implementation state for this task.

## Verification

Ran the task’s required red-phase checks. `bun test scripts/verify-m065.test.ts` failed because the new contract suite cannot import `scripts/verify-m065.ts`, proving the implementation does not exist yet, and the package-wiring assertion also failed because `package.json` has no `verify:m065` script. `bun test scripts/verify-m065.test.ts -t "stable top-level check ids"` also failed for the same missing-module reason, confirming the pinned-ID contract is exercising the intended future entrypoint.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/verify-m065.test.ts` | 1 | ✅ pass | 82ms |
| 2 | `bun test scripts/verify-m065.test.ts -t "stable top-level check ids"` | 1 | ✅ pass | 75ms |

## Deviations

None.

## Known Issues

`scripts/verify-m065.ts` is still missing, and `package.json` does not yet define `verify:m065`; those are intentional red-phase gaps for T02.

## Files Created/Modified

- `scripts/verify-m065.test.ts`
