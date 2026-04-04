---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add end-to-end backfill and retrieval verifier

- Add an end-to-end verifier for M041/S02 covering one-time backfill plus review-style retrieval.
- Use a production-like fixture repo snapshot or equivalent fixture package.
- Prove retrieval hits canonical current-code rows rather than historical diff-hunk rows.

## Inputs

- `src/knowledge/canonical-code-backfill.ts`
- `src/knowledge/canonical-code-retrieval.ts`
- `.gsd/milestones/M041/M041-CONTEXT.md`

## Expected Output

- `scripts/verify-m041-s02.ts`
- `scripts/verify-m041-s02.test.ts`

## Verification

bun test ./scripts/verify-m041-s02.test.ts && bun run verify:m041:s02 -- --json

## Observability Impact

Produces machine-checkable proof output for backfill and retrieval behavior.
