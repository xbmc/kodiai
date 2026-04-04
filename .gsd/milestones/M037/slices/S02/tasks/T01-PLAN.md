---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Score findings against thematic cluster models

- Implement thematic scoring for draft findings against positive and negative cluster centroids.
- Return suppression and confidence-adjustment signals without mutating durable rule state.
- Add scoring tests for conservative thresholds.

## Inputs

- `src/knowledge/suggestion-cluster-store.ts`
- `src/knowledge/suggestion-cluster-builder.ts`
- `.gsd/milestones/M037/M037-CONTEXT.md`

## Expected Output

- `src/knowledge/suggestion-cluster-scoring.ts`
- `src/knowledge/suggestion-cluster-scoring.test.ts`

## Verification

bun test ./src/knowledge/suggestion-cluster-scoring.test.ts && bun run tsc --noEmit

## Observability Impact

Adds suppression/boost scoring surfaces before review output generation.
