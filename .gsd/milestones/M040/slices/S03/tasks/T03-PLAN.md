---
estimated_steps: 3
estimated_files: 5
skills_used: []
---

# T03: Add boundedness and fail-open verifier

- Add the milestone-level verifier for large-PR graph use and small-PR bypass.
- Cover bounded prompt context, fail-open behavior, and optional validation outcomes.
- Emit machine-checkable proof output that can close M040 without hand inspection.

## Inputs

- `src/review-graph/prompt-context.ts`
- `src/review-graph/validation.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M040/M040-CONTEXT.md`

## Expected Output

- `scripts/verify-m040-s03.ts`
- `scripts/verify-m040-s03.test.ts`

## Verification

bun test ./scripts/verify-m040-s03.test.ts && bun run verify:m040:s03 -- --json

## Observability Impact

Provides stable proof IDs for boundedness, bypass, and fail-open validation behavior.
