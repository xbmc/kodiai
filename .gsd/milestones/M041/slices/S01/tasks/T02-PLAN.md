---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T02: Implement chunker and exclusion policy

- Implement a canonical chunker for function/class/module fallback boundaries.
- Add explicit exclusion rules for generated files, vendored code, lockfiles, and build outputs.
- Keep chunking logic independent from historical diff-hunk chunking so semantics do not blur.

## Inputs

- `.gsd/milestones/M041/M041-CONTEXT.md`
- `src/knowledge/code-snippet-chunker.ts`

## Expected Output

- `src/knowledge/canonical-code-chunker.ts`
- `src/knowledge/canonical-code-chunker.test.ts`

## Verification

bun test ./src/knowledge/canonical-code-chunker.test.ts

## Observability Impact

Adds exclusion and chunk-boundary signals that later audit paths can explain.
