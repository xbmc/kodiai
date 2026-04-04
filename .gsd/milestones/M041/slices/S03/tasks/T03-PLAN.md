---
estimated_steps: 3
estimated_files: 5
skills_used: []
---

# T03: Add selective-update and repair verifier

- Add the milestone-level verifier for selective updates and repair.
- Cover unchanged-file preservation, drift detection, and selective repair outcomes.
- Emit machine-checkable proof output that can close the milestone without requiring a full live repo rebuild.

## Inputs

- `src/knowledge/canonical-code-update.ts`
- `src/knowledge/embedding-audit.ts`
- `src/knowledge/embedding-repair.ts`
- `.gsd/milestones/M041/M041-CONTEXT.md`

## Expected Output

- `scripts/verify-m041-s03.ts`
- `scripts/verify-m041-s03.test.ts`

## Verification

bun test ./scripts/verify-m041-s03.test.ts && bun run verify:m041:s03 -- --json

## Observability Impact

Provides stable proof IDs and drift-state output for future re-verification.
