---
id: T03
parent: S02
milestone: M038
key_files:
  - scripts/verify-m038-s02.ts
  - scripts/verify-m038-s02.test.ts
  - package.json
  - .gsd/milestones/M038/slices/S02/tasks/T03-SUMMARY.md
key_decisions:
  - Verified structural-impact rendering through the real prompt and Review Details integration seams instead of duplicating formatter internals.
  - Used a small fixed JSON proof envelope with explicit per-scenario booleans and stable status codes to keep the verifier machine-checkable.
duration: 
verification_result: passed
completed_at: 2026-04-05T19:35:01.641Z
blocker_discovered: false
---

# T03: Added a fixture-based structural-impact verifier for C++ and Python review rendering with stable JSON proof output and a new verify:m038:s02 script.

**Added a fixture-based structural-impact verifier for C++ and Python review rendering with stable JSON proof output and a new verify:m038:s02 script.**

## What Happened

Built scripts/verify-m038-s02.ts as a deterministic proof harness that exercises the real buildReviewPrompt() and formatReviewDetailsSummary() rendering seams with language-priority C++ and Python structural-impact fixtures. The harness evaluates a fixed pair of checks proving that Review Details renders a bounded Structural Impact section and that breaking-change wording is strengthened from structural evidence when present. Added scripts/verify-m038-s02.test.ts to cover the real fixtures, check evaluation behavior, JSON round-tripping, and stable failure-contract rendering. Also added the verify:m038:s02 package script and reran the exact task verification command after fixing an initial ESM-readonly export mutation bug in one test.

## Verification

Ran the task-plan verification command exactly: bun test ./scripts/verify-m038-s02.test.ts && bun run verify:m038:s02 -- --json. The tests passed 8/8, and the verifier emitted a passing JSON envelope with both M038-S02 check IDs green for the real C++ and Python scenarios.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m038-s02.test.ts && bun run ./scripts/verify-m038-s02.ts --json` | 0 | ✅ pass | 45ms |
| 2 | `bun test ./scripts/verify-m038-s02.test.ts && bun run verify:m038:s02 -- --json` | 0 | ✅ pass | 45ms |

## Deviations

None.

## Known Issues

The verifier is fixture-based and hermetic; it proves the real prompt/review-details rendering contract but does not call live graph or corpus adapters.

## Files Created/Modified

- `scripts/verify-m038-s02.ts`
- `scripts/verify-m038-s02.test.ts`
- `package.json`
- `.gsd/milestones/M038/slices/S02/tasks/T03-SUMMARY.md`
