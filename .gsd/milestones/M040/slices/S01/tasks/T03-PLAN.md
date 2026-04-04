---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Build incremental graph indexer

- Build the graph indexing and incremental-update path from workspace contents.
- Re-index only changed files and replace their graph records atomically.
- Add fixture tests proving incremental updates do not require full graph rebuilds.

## Inputs

- `src/review-graph/store.ts`
- `src/review-graph/extractors/index.ts`
- `src/jobs/workspace.ts`

## Expected Output

- `src/review-graph/indexer.ts`
- `src/review-graph/indexer.test.ts`

## Verification

bun test ./src/review-graph/indexer.test.ts

## Observability Impact

Adds indexed/updated/skipped counts for graph upkeep.
