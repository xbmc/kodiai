---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add activation and prompt-injection verifier

- Add a verifier showing a high-confidence proposal becomes active and appears in the next review prompt.
- Keep proof output machine-checkable and bounded.
- Cover fail-open behavior when rule lookup fails.

## Inputs

- `src/knowledge/generated-rule-activation.ts`
- `src/knowledge/active-rules.ts`
- `.gsd/milestones/M036/M036-CONTEXT.md`

## Expected Output

- `scripts/verify-m036-s02.ts`
- `scripts/verify-m036-s02.test.ts`

## Verification

bun test ./scripts/verify-m036-s02.test.ts && bun run verify:m036:s02 -- --json

## Observability Impact

Produces stable proof output for activation and prompt injection.
