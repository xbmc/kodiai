---
id: T03
parent: S03
milestone: M048
key_files:
  - scripts/verify-m048-s03.ts
  - scripts/verify-m048-s03.test.ts
  - package.json
key_decisions:
  - Kept `verify:m048:s03` successful in local-only mode when `--review-output-key` is omitted or expands empty so pre-deploy verification stays cheap and the slice’s quoted env-var command remains truthful.
  - Embedded the reused `verify:m048:s01` phase-timing report directly inside S03 live output instead of inventing a separate Azure evidence schema.
duration: 
verification_result: passed
completed_at: 2026-04-13T04:26:44.640Z
blocker_discovered: false
---

# T03: Added verify:m048:s03 with synchronize-config preflight, bounded-disclosure fixture proof, and optional live synchronize evidence reuse.

**Added verify:m048:s03 with synchronize-config preflight, bounded-disclosure fixture proof, and optional live synchronize evidence reuse.**

## What Happened

I followed a TDD loop for the new verifier by adding `scripts/verify-m048-s03.test.ts` first, then watching it fail on the missing script and package wiring before implementing the command. The new test coverage locks the contract for checked-in config preflight success, legacy top-level `review.onSynchronize` drift failure, bounded-disclosure fixture drift, acceptance of synchronize keys only, empty optional live input, and package-script wiring.

I then implemented `scripts/verify-m048-s03.ts` as a two-stage verifier. The local stage uses `loadRepoConfig(...)` plus an explicit `.kodiai.yml` presence check to fail loudly when synchronize proof drifts because the checked-in repo config is missing, mis-shaped, warned, or effectively leaves `review.triggers.onSynchronize` disabled. The bounded-disclosure stage reuses the shared T02 helper instead of inventing new logic: it evaluates large-PR strict, timeout auto-reduced, and small-unbounded fixtures, checks the exact disclosure sentences, and verifies that summary backfill inserts the disclosure exactly once when required.

For live proof, I kept the evidence path truthful and reused the S01 seam instead of creating a parallel store. `verify:m048:s03` normalizes the optional `--review-output-key`, rejects malformed or non-`synchronize` keys before any live lookup runs, and when the key is valid it embeds the reused `verify:m048:s01` phase-timing report directly into the S03 JSON/human output. I also kept empty `--review-output-key` input as a successful local-only run so the slice’s quoted env-var verification command stays cheap and truthful before deployment.

## Verification

Fresh verification passed at both the task and slice levels. `bun test ./scripts/verify-m048-s03.test.ts ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts` passed for the new verifier contract plus config and boundedness coverage. `bun run tsc --noEmit` passed cleanly after the script and package updates. The full slice test command `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts` passed. Both verifier modes also passed: `bun run verify:m048:s03 -- --json` returned `m048_s03_ok` with successful local preflight and fixture proof, and `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` also returned `m048_s03_ok` with live mode truthfully skipped because the quoted key expanded empty in this environment.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m048-s03.test.ts ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts` | 0 | ✅ pass | 156ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8679ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts` | 0 | ✅ pass | 4061ms |
| 4 | `bun run verify:m048:s03 -- --json` | 0 | ✅ pass | 66ms |
| 5 | `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` | 0 | ✅ pass | 64ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m048-s03.ts`
- `scripts/verify-m048-s03.test.ts`
- `package.json`
