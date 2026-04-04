---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Create cluster-model schema and store

- Add cluster-model schema and store surfaces for positive/negative centroids and freshness metadata.
- Keep model storage separate from durable generated rules.
- Add tests for model persistence and retrieval.

## Inputs

- `.gsd/milestones/M037/M037-CONTEXT.md`
- `src/knowledge/cluster-matcher.ts`
- `src/knowledge/store.ts`

## Expected Output

- `src/db/migrations/036-suggestion-cluster-models.sql`
- `src/knowledge/suggestion-cluster-store.ts`
- `src/knowledge/suggestion-cluster-store.test.ts`

## Verification

bun test ./src/knowledge/suggestion-cluster-store.test.ts && bun run tsc --noEmit

## Observability Impact

Adds durable model freshness and member-count surfaces.
