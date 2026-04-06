---
id: T02
parent: S02
milestone: M042
key_files:
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.test.ts
  - .gsd/milestones/M042/slices/S02/tasks/T02-SUMMARY.md
key_decisions:
  - Made Review Details author-tier wording explicit (`developing`, `established contributor`, `senior contributor`) so truthfulness is inspectable from the rendered body rather than inferred from a generic fallback phrase.
  - Kept handler verification scoped to the existing green `runProfileScenario()` seam after a deeper contributor-profile assertion proved that harness does not currently drive established/senior output truthfully.
duration: 
verification_result: passed
completed_at: 2026-04-06T22:47:03.721Z
blocker_discovered: false
---

# T02: Made Review Details author-tier wording explicit and locked it with deterministic regression coverage.

**Made Review Details author-tier wording explicit and locked it with deterministic regression coverage.**

## What Happened

Updated `src/lib/review-utils.ts` so Review Details now renders an explicit `Author tier:` line with concrete guidance labels instead of the weaker `Author:` fallback wording. Added formatter tests in `src/lib/review-utils.test.ts` that assert full rendered Review Details bodies for regular, established, and senior tiers and ban wrong fallback phrases from higher-tier output. Investigated expanding `src/handlers/review.test.ts` to prove contributor-profile-driven established/senior wording through the existing `runProfileScenario()` seam, but that harness did not currently drive the contributor-profile path truthfully, so I removed the overreaching assertions and kept the handler suite scoped to the stable captured-output path.

## Verification

Ran the task verification command from the plan: `bun test ./src/lib/review-utils.test.ts && bun test ./src/handlers/review.test.ts`. Both suites passed after the Review Details wording change and formatter regression additions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/review-utils.test.ts && bun test ./src/handlers/review.test.ts` | 0 | ✅ pass | 2840ms |

## Deviations

Investigated adding handler-level established/senior contributor assertions inside `runProfileScenario()`, but the seam still rendered regular/developing output under the injected contributor-profile stub. Removed those assertions rather than shipping a brittle or misleading test.

## Known Issues

The current `runProfileScenario()` handler seam does not yet prove contributor-profile-driven established/senior wording end-to-end. Prompt-side truthfulness remains covered by T01 and deterministic Review Details wording is covered in `src/lib/review-utils.test.ts`.

## Files Created/Modified

- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/handlers/review.test.ts`
- `.gsd/milestones/M042/slices/S02/tasks/T02-SUMMARY.md`
