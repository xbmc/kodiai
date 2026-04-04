---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Implement auto-activation policy

- Implement activation logic for pending rules based on configurable positive-signal thresholds.
- Keep activation policy explicit and testable.
- Add store tests for pending -> active transitions.

## Inputs

- `src/knowledge/generated-rule-store.ts`
- `.gsd/milestones/M036/M036-CONTEXT.md`

## Expected Output

- `src/knowledge/generated-rule-activation.ts`
- `src/knowledge/generated-rule-activation.test.ts`

## Verification

bun test ./src/knowledge/generated-rule-activation.test.ts && bun run tsc --noEmit

## Observability Impact

Adds activation decisions and threshold-hit signals.
