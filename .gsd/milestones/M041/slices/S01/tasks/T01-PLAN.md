---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T01: Create canonical corpus schema and store contract

- Add the first canonical-corpus migration with dedicated tables and indexes.
- Define explicit types for canonical chunk identity, provenance, and replacement semantics.
- Implement a store module that is clearly separate from historical snippet storage.

## Inputs

- `.gsd/milestones/M041/M041-CONTEXT.md`
- `src/db/migrations/009-code-snippets.sql`
- `src/knowledge/code-snippet-store.ts`

## Expected Output

- `src/db/migrations/033-canonical-code-corpus.sql`
- `src/knowledge/canonical-code-types.ts`
- `src/knowledge/canonical-code-store.ts`
- `src/knowledge/canonical-code-store.test.ts`

## Verification

bun test ./src/knowledge/canonical-code-store.test.ts && bun run tsc --noEmit

## Observability Impact

Makes provenance and replacement fields durable and queryable.
