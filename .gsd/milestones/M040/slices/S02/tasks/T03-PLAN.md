---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add graph-aware selection verifier

- Add a fixture-based verifier comparing current file-level selection with graph-aware selection on a production-like large PR shape.
- Prove graph-aware selection surfaces impacted files/tests that current triage alone would miss.
- Keep proof output machine-checkable for later milestone closure.

## Inputs

- `src/review-graph/query.ts`
- `src/lib/file-risk-scorer.ts`
- `.gsd/milestones/M040/M040-CONTEXT.md`

## Expected Output

- `scripts/verify-m040-s02.ts`
- `scripts/verify-m040-s02.test.ts`

## Verification

bun test ./scripts/verify-m040-s02.test.ts && bun run verify:m040:s02 -- --json

## Observability Impact

Produces stable proof output for graph-aware selection gains.
