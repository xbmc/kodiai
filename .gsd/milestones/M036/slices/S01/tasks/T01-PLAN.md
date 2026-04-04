---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Create generated-rule schema and store

- Add generated-rule schema and store surfaces for pending/active/retired lifecycle state.
- Keep generated rules separate from raw learning-memory records.
- Add tests for persistence and lifecycle-state transitions.

## Inputs

- `.gsd/milestones/M036/M036-CONTEXT.md`
- `src/knowledge/memory-store.ts`
- `src/knowledge/store.ts`

## Expected Output

- `src/db/migrations/035-generated-rules.sql`
- `src/knowledge/generated-rule-store.ts`
- `src/knowledge/generated-rule-store.test.ts`

## Verification

bun test ./src/knowledge/generated-rule-store.test.ts && bun run tsc --noEmit

## Observability Impact

Adds durable lifecycle-state and proposal-count surfaces.
