---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Build fixture ingest and replacement semantics

- Build a fixture-driven ingest path that turns parsed files into canonical rows.
- Prove idempotent replacement behavior using content hash and chunk identity.
- Verify canonical ingest never writes into historical diff-hunk tables.

## Inputs

- `src/knowledge/canonical-code-store.ts`
- `src/knowledge/canonical-code-chunker.ts`
- `src/knowledge/code-snippet-store.ts`

## Expected Output

- `src/knowledge/canonical-code-ingest.ts`
- `src/knowledge/canonical-code-ingest.test.ts`

## Verification

bun test ./src/knowledge/canonical-code-ingest.test.ts

## Observability Impact

Adds ingest counts and replacement outcomes for fixture proof.
