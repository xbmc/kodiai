---
estimated_steps: 3
estimated_files: 5
skills_used: []
---

# T02: Extend audit and repair for canonical corpus drift

- Extend audit and repair flows to cover the canonical current-code corpus.
- Detect stale, missing, and model-mismatched canonical rows.
- Repair only the affected rows or files, fail-open on per-file failures, and keep the existing audit/repair patterns intact.

## Inputs

- `src/knowledge/embedding-audit.ts`
- `src/knowledge/embedding-repair.ts`
- `src/knowledge/canonical-code-store.ts`

## Expected Output

- `src/knowledge/embedding-audit.ts`
- `src/knowledge/embedding-repair.ts`
- `scripts/embedding-audit.ts`
- `scripts/embedding-repair.ts`

## Verification

bun test ./scripts/embedding-audit.test.ts && bun test ./scripts/embedding-repair.test.ts

## Observability Impact

Surfaces stale, missing, and model-mismatch counts for the canonical corpus in existing operator tools.
