---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T01: Implement selective changed-file refresh

- Implement a changed-file refresh path that reprocesses only touched files or changed chunks.
- Reuse canonical chunk identity and content hashes to avoid rewriting unchanged rows.
- Keep the normal update path separate from one-time backfill semantics.

## Inputs

- `src/knowledge/canonical-code-store.ts`
- `src/knowledge/canonical-code-backfill.ts`
- `.gsd/milestones/M041/M041-CONTEXT.md`

## Expected Output

- `src/knowledge/canonical-code-update.ts`
- `src/knowledge/canonical-code-update.test.ts`

## Verification

bun test ./src/knowledge/canonical-code-update.test.ts && bun run tsc --noEmit

## Observability Impact

Adds updated/unchanged/replaced counters for steady-state refresh.
