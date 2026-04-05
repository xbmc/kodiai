---
id: T02
parent: S02
milestone: M038
key_files:
  - src/handlers/review.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - .gsd/milestones/M038/slices/S02/tasks/T02-SUMMARY.md
key_decisions:
  - Threaded structural-impact data through the existing review integration by passing the bounded `payload` into prompt and Review Details rendering while leaving `graphBlastRadius` as the separate graph-only signal.
  - Strengthened breaking-change guidance only from truthful available structural evidence fields and emitted an explicit fallback-used instruction path when structural evidence is absent or partial.
duration: 
verification_result: mixed
completed_at: 2026-04-05T19:30:18.707Z
blocker_discovered: false
---

# T02: Integrated Structural Impact into review prompts and Review Details with explicit breaking-change evidence and fallback guidance.

**Integrated Structural Impact into review prompts and Review Details with explicit breaking-change evidence and fallback guidance.**

## What Happened

Integrated bounded Structural Impact evidence into the main review flow by capturing the nested payload returned from `fetchReviewStructuralImpact`, preserving the existing graph blast-radius path, and threading the payload into both main and retry prompt generation plus Review Details rendering. Added a prompt-level Structural Impact section and explicit breaking-change evidence handling instructions that distinguish evidence-present, partial-evidence, and fallback-used cases so the reviewer can strengthen breaking-change output only when truthful structural support exists. Added focused prompt tests for evidence-present, fallback-used, and partial structural-impact behavior, then corrected a wrapper-vs-payload type mismatch uncovered by a follow-up typecheck and reran verification to green.

## Verification

Ran the task-plan verification command `bun test ./src/execution/review-prompt.test.ts`, which passed. Then ran `bun run tsc --noEmit` as a compile-safety smoke check for the touched integration points; the first run failed due to a real wrapper-vs-payload mismatch and invalid test fixture fields, which I fixed by aligning the code to the actual `fetchReviewStructuralImpact` and `StructuralImpactPayload` contracts. Reran `bun test ./src/execution/review-prompt.test.ts && bun run tsc --noEmit`, and both passed cleanly.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/review-prompt.test.ts` | 0 | ✅ pass | 47ms |
| 2 | `bun run tsc --noEmit` | 2 | ❌ fail | 3100ms |
| 3 | `bun test ./src/execution/review-prompt.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 6200ms |

## Deviations

Ran an additional `bun run tsc --noEmit` smoke check beyond the task-plan verification command because the work crossed handler/prompt boundaries, and the first pass exposed a real wrapper-vs-payload type mismatch that required correction.

## Known Issues

This task improves prompt and Review Details integration but does not yet add the dedicated end-to-end structural-impact verifier planned for T03.

## Files Created/Modified

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `.gsd/milestones/M038/slices/S02/tasks/T02-SUMMARY.md`
