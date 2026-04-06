---
estimated_steps: 2
estimated_files: 4
skills_used: []
---

# T02: Add handler regressions for cache-hit, contradictory-cache, and retry truthfulness

Expand `src/handlers/review.test.ts` using the existing handler scaffolding rather than new broad test harnesses. Add focused scenarios that assert on the full rendered prompt/details bodies and prove: cached `core` maps to senior-style wording; cached `regular` maps to developing wording without overclaiming; contributor-profile `established` or `senior` still beats contradictory cached low-tier data in a real handler execution; and retry/degraded paths continue to thread the same resolved author tier into rebuilt prompt output.

Follow the established project rule from M028/S03/T02 and S02: assert on full rendered bodies with required and banned phrases, not proxy metadata or single marker lines.

## Inputs

- `src/handlers/review.test.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`
- `.gsd/milestones/M042/slices/S01/S01-SUMMARY.md`
- `.gsd/milestones/M042/slices/S02/S02-SUMMARY.md`

## Expected Output

- `src/handlers/review.test.ts`

## Verification

bun test ./src/handlers/review.test.ts

## Observability Impact

These tests become the orchestration-level diagnostic surface for cache-hit and degraded retry behavior. They should make it obvious from a failing assertion whether the regression came from source selection, prompt wording, details wording, or retry-path rebuilds.
