---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T01: Create graph schema and store contract

- Add graph persistence schema for files, symbols, edges, and graph-build bookkeeping.
- Define graph node/edge types and a store module separate from retrieval and prompt code.
- Keep the storage model tuned for incremental replacement instead of full graph rebuilds.

## Inputs

- `.gsd/milestones/M040/M040-CONTEXT.md`
- `src/db/migrations/001-initial-schema.sql`

## Expected Output

- `src/db/migrations/034-review-graph.sql`
- `src/review-graph/types.ts`
- `src/review-graph/store.ts`
- `src/review-graph/store.test.ts`

## Verification

bun test ./src/review-graph/store.test.ts && bun run tsc --noEmit

## Observability Impact

Makes graph nodes, edges, and build-state counts durable and queryable.
