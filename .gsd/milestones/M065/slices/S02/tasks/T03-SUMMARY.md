---
id: T03
parent: S02
milestone: M065
key_files:
  - scripts/verify-m065.ts
  - scripts/verify-m065.test.ts
key_decisions:
  - Preserved the existing milestone composition pattern by threading S02 through `nested_reports.s02` and stable drill-down metadata instead of flattening live-proof evidence into prose.
  - Used a valid canonical sample `reviewOutputKey` for the top-level S02 invocation so the real verifier fails on missing live evidence rather than on malformed identity input.
duration: 
verification_result: passed
completed_at: 2026-04-24T09:03:06.222Z
blocker_discovered: false
---

# T03: Wired verify:m065 to compose the authoritative S02 live-proof report while leaving only the S03 fresh-regression obligation pending in the passing contract.

**Wired verify:m065 to compose the authoritative S02 live-proof report while leaving only the S03 fresh-regression obligation pending in the passing contract.**

## What Happened

I followed the required TDD/debugging flow. First I read the existing `verify:m065` composition and replaced the old placeholder-focused tests in `scripts/verify-m065.test.ts` with RED coverage that pinned the intended S02 wiring contract: preserve the new `nested_reports.s02` payload verbatim, map it into the top-level `M065-LIVE-LARGE-PR-PROOF` check, keep prerequisite failure ordering intact, treat malformed S02 payloads as nested-contract failures, and leave `M065-FRESH-REGRESSION-PROOF` as the only remaining pending obligation once S02 succeeds. The first red run confirmed the root cause cleanly: `evaluateM065` never invoked `verify:m065:s02`, never carried an S02 nested report, and still hardcoded the live-proof slot as pending.

I then rewrote `scripts/verify-m065.ts` to extend the existing S01 composition pattern rather than inventing a new surface. The top-level verifier now imports and evaluates `verify:m065:s02`, validates that nested payload with its own stricter contract, stores it under `nested_reports.s02`, renders its status in human output, and translates it into `M065-LIVE-LARGE-PR-PROOF` as either `rollout_obligation_satisfied`, `nested_report_failed`, or `nested_report_malformed`. I kept the M062/M063/M064 prerequisite checks and failure ordering unchanged, preserved the fresh-regression S03 slot as the only explicit pending rollout obligation in the passing-contract case, and retained the same top-level status semantics where malformed nested evidence fails hard, failed nested verifiers fail hard, and pending-only states are still surfaced mechanically.

After the first GREEN pass exposed that my seeded representative key for the top-level live run used the wrong identity format, I traced that back to `parseReviewOutputKey` in `src/handlers/review-idempotency.ts` and swapped the placeholder for the valid canonical sample key already exercised in T02. That changed the real `bun run verify:m065 -- --json` behavior from an unhelpful `m065_s02_invalid_arg` failure into the intended drill-down-friendly `m065_s02_nested_verifier_failed` report, with `failing_check_id` anchored on `M065-LIVE-LARGE-PR-PROOF`, preserved nested S02 proof output, and explicit subproof failure details for runtime timing, visible review access, and operator evidence sufficiency. I attempted to persist the reusable verifier-composition pattern in memory, but `capture_thought` failed with `failed to create memory`, so that note could not be stored durably.

## Verification

Verified the new composition contract with `bun test scripts/verify-m065.test.ts`, which passed all 9 tests covering S02 nested report preservation, malformed/failing S02 handling, prerequisite-first failure ordering, human rendering, and top-level pending-only semantics when only S03 remains. Re-ran `bun test scripts/verify-m065-s02.test.ts` to confirm the nested S02 verifier contract still passed unchanged at 16/16 after the top-level wiring. Exercised the real operator surface with `bun run verify:m065 -- --json`; it exited 1 as expected in this environment, but the output now failed for the correct reason: `M065-LIVE-LARGE-PR-PROOF` is backed by the nested S02 report with `nested_status_code: m065_s02_nested_verifier_failed`, while `M065-FRESH-REGRESSION-PROOF` remains the pending downstream obligation. This satisfied the task’s observability requirement by localizing the live-proof failure mechanically instead of failing in argument parsing or flattening nested evidence.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/verify-m065.test.ts` | 0 | ✅ pass | 84ms |
| 2 | `bun test scripts/verify-m065-s02.test.ts` | 0 | ✅ pass | 143ms |
| 3 | `bun run verify:m065 -- --json` | 1 | ✅ pass | 29557ms |

## Deviations

Used the canonical sample `reviewOutputKey` from T02’s verified smoke command as the representative proof target constant inside `verify:m065` so the real top-level command would exercise the nested S02 failure surface truthfully. This was a local adaptation to match the repository’s actual `parseReviewOutputKey` contract; it did not change the slice contract or add new behavior beyond the planned wiring.

## Known Issues

`bun run verify:m065 -- --json` still returns a failing live-proof report in the current environment because the representative sample run does not have matching runtime timing evidence, GitHub review artifact access returns 403/unavailable, and canonical operator evidence resolves to `missing-canonical-row`; this is expected for the current environment and is now reported explicitly. `capture_thought` also failed with `failed to create memory`, so the reusable verifier-composition pattern was not persisted to the memory store.

## Files Created/Modified

- `scripts/verify-m065.ts`
- `scripts/verify-m065.test.ts`
