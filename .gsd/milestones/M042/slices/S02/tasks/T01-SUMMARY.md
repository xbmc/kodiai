---
id: T01
parent: S02
milestone: M042
key_files:
  - src/execution/review-prompt.test.ts
  - .gsd/milestones/M042/slices/S02/tasks/T01-SUMMARY.md
key_decisions:
  - Kept buildAuthorExperienceSection() copy unchanged because the existing taxonomy mapping was already correct; the missing protection was negative regression coverage on rendered output.
  - Used full rendered author-section assertions with banned-phrase checks instead of proxy assertions so prompt truthfulness is directly inspectable.
duration: 
verification_result: passed
completed_at: 2026-04-06T22:40:41.016Z
blocker_discovered: false
---

# T01: Added prompt regression tests that lock established and senior author tiers away from newcomer and developing guidance.

**Added prompt regression tests that lock established and senior author tiers away from newcomer and developing guidance.**

## What Happened

Verified the S02 prompt-rendering seam against the local code and research notes, then kept the existing buildAuthorExperienceSection() wording unchanged because the mapping was already correct. Hardened src/execution/review-prompt.test.ts with focused negative guards for established and senior tiers, plus full buildReviewPrompt() assertions that isolate the rendered Author Experience Context section and prove newcomer/developing phrases do not appear for higher contributor tiers.

## Verification

Ran the task verification command from the plan: bun test ./src/execution/review-prompt.test.ts. The suite passed with 211 passing tests and 0 failures, including the new established/senior regression coverage and full rendered-section prompt assertions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/review-prompt.test.ts` | 0 | ✅ pass | 42ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/execution/review-prompt.test.ts`
- `.gsd/milestones/M042/slices/S02/tasks/T01-SUMMARY.md`
