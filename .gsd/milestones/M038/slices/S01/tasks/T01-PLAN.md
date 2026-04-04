---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Define graph/corpus consumer contracts

- Define the consumer-facing structural-impact types and adapter contracts for graph and canonical-corpus queries.
- Keep the adapters explicitly dependent on M040/M041 interfaces rather than reaching into substrate internals.
- Model bounded payload fields for callers, dependents, impacted files, likely tests, and unchanged-code evidence.

## Inputs

- `.gsd/milestones/M038/M038-CONTEXT.md`
- `.gsd/milestones/M040/M040-CONTEXT.md`
- `.gsd/milestones/M041/M041-CONTEXT.md`

## Expected Output

- `src/structural-impact/types.ts`
- `src/structural-impact/adapters.ts`
- `src/structural-impact/adapters.test.ts`

## Verification

bun test ./src/structural-impact/adapters.test.ts && bun run tsc --noEmit

## Observability Impact

Creates explicit fetch/degradation shapes for structural-impact orchestration.
