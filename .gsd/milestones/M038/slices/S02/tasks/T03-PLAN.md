---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add Structural Impact rendering verifier

- Add a fixture-based verifier for C++ and Python review scenarios.
- Prove Review Details shows a bounded Structural Impact section and uses structural evidence for breaking-change wording when available.
- Keep proof output stable and machine-checkable.

## Inputs

- `src/lib/structural-impact-formatter.ts`
- `src/structural-impact/orchestrator.ts`
- `.gsd/milestones/M038/M038-CONTEXT.md`

## Expected Output

- `scripts/verify-m038-s02.ts`
- `scripts/verify-m038-s02.test.ts`

## Verification

bun test ./scripts/verify-m038-s02.test.ts && bun run verify:m038:s02 -- --json

## Observability Impact

Produces stable proof output for user-visible structural-impact rendering.
