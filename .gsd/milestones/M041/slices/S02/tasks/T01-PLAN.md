---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T01: Build default-branch backfill pipeline

- Resolve the repo's canonical default-branch snapshot using existing workspace access patterns.
- Build a one-time backfill job that walks eligible files and writes canonical chunks.
- Keep the path fail-open and bounded when parsing or embedding individual files fails.

## Inputs

- `.gsd/milestones/M041/M041-CONTEXT.md`
- `src/jobs/workspace.ts`
- `src/knowledge/embedding-repair.ts`

## Expected Output

- `src/knowledge/canonical-code-backfill.ts`
- `src/knowledge/canonical-code-backfill.test.ts`

## Verification

bun test ./src/knowledge/canonical-code-backfill.test.ts && bun run tsc --noEmit

## Observability Impact

Adds backfill counts, skipped-file counts, and fail-open warnings.
