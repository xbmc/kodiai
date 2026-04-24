---
id: T03
parent: S03
milestone: M063
key_files:
  - src/handlers/review.test.ts
key_decisions:
  - Kept the task at the proof seam by strengthening handler-path tests instead of changing `src/handlers/review.ts`, because the shipped retry merge already rechecked publish rights before both public writes.
  - Modeled stale-authority suppression against actual coordinator behavior: a newer attempt must remain active to block an older retry, while the between-write case is best proven by dropping `canPublish` after the canonical summary update.
duration: 
verification_result: passed
completed_at: 2026-04-24T06:37:34.295Z
blocker_discovered: false
---

# T03: Extended retry handler coverage to prove stale continuation cannot rewrite the canonical summary, cannot refresh nested Review Details after losing rights, and stays publicly quiet on no-delta settlement.

**Extended retry handler coverage to prove stale continuation cannot rewrite the canonical summary, cannot refresh nested Review Details after losing rights, and stays publicly quiet on no-delta settlement.**

## What Happened

I audited the shipped retry merge path in `src/handlers/review.ts` before changing code and found the last-mile authority checks already lived on the two public retry writes: the canonical summary merge and the follow-up Review Details refresh. The gap was in handler-path proof, not implementation. I extended `src/handlers/review.test.ts` with three narrow retry-path cases anchored to the real same-surface continuation flow: one keeps a newer explicit attempt active so a queued retry loses publish rights before the canonical summary merge; one allows the canonical merge but flips rights before the nested Review Details refresh; and one feeds the no-delta classifier with matching continuation findings so settlement stays a true public no-op on the canonical comment. While writing those tests I had to adapt to the coordinator’s actual semantics: completed superseding attempts are removed from family state and do not continue to block publish rights, so stale-authority proof needs either an active newer attempt or an injected `canPublish` drop at the exact write boundary. The new assertions verify both public mutation behavior and the suppression logs that identify which retry write path was blocked. No production handler changes were needed because the existing guards satisfied the stricter cases once the tests exercised the real paths correctly.

## Verification

I first ran `bun test src/handlers/review.test.ts --filter "retry"` after adding the new tests and used the failures to correct the test model, not the handler: the coordinator only blocks while newer work remains active, and the timeout first-pass path performs an initial same-comment Review Details refresh that required before/after update baselines. After fixing the tests, I reran the retry-filtered handler suite and all retry-path cases passed, including the new stale-authority and quiet-settlement scenarios. I then ran the slice regression verifier `bun run verify:m063:s02 -- --json`, which returned `success: true` with `status_code: "m063_s02_ok"` and a passing `same-surface-quiet-settlement` scenario. Finally, I ran `bun run tsc --noEmit`, which exited cleanly with no diagnostics.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/handlers/review.test.ts --filter "retry"` | 0 | ✅ pass | 9324ms |
| 2 | `bun run verify:m063:s02 -- --json` | 0 | ✅ pass | 42ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 11926ms |

## Deviations

None.

## Known Issues

`capture_thought` failed when I attempted to store a coordinator-semantics gotcha, so that cross-session memory was not persisted. The task implementation and verification were unaffected.

## Files Created/Modified

- `src/handlers/review.test.ts`
