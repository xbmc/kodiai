---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add lifecycle verifier

- Add the milestone-level verifier for proposal, activation, retirement, and fail-open behavior.
- Keep proof output stable enough to close M036 without hand inspection.
- Cover notification failure as a non-blocking path.

## Inputs

- `src/knowledge/generated-rule-retirement.ts`
- `src/knowledge/generated-rule-notify.ts`
- `.gsd/milestones/M036/M036-CONTEXT.md`

## Expected Output

- `scripts/verify-m036-s03.ts`
- `scripts/verify-m036-s03.test.ts`

## Verification

bun test ./scripts/verify-m036-s03.test.ts && bun run verify:m036:s03 -- --json

## Observability Impact

Provides stable proof IDs for lifecycle completion and fail-open notifications.
