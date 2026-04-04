---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Add blast-radius and likely-test queries

- Implement graph query surfaces for blast radius, impacted files, probable dependents, and likely tests.
- Add confidence/ranking output instead of pretending every graph edge is equally certain.
- Prove query usefulness against C++ and Python fixtures.

## Inputs

- `src/review-graph/store.ts`
- `src/review-graph/indexer.ts`
- `.gsd/milestones/M040/M040-CONTEXT.md`

## Expected Output

- `src/review-graph/query.ts`
- `src/review-graph/query.test.ts`

## Verification

bun test ./src/review-graph/query.test.ts && bun run tsc --noEmit

## Observability Impact

Adds impacted-file and likely-test ranking surfaces for downstream selection.
