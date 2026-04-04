---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Add bounded graph prompt context

- Add a bounded graph-context section to the review prompt for impacted files, tests, and dependency chains.
- Pack graph evidence by rank and cap size so blast radius never becomes a raw dump.
- Add tests for prompt rendering and bounded packing behavior.

## Inputs

- `src/execution/review-prompt.ts`
- `src/review-graph/query.ts`
- `.gsd/milestones/M040/M040-CONTEXT.md`

## Expected Output

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/review-graph/prompt-context.ts`

## Verification

bun test ./src/execution/review-prompt.test.ts

## Observability Impact

Adds explicit graph-context counts and truncation surfaces for prompt assembly.
