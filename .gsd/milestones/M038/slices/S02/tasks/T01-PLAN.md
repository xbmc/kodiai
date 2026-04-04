---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Format bounded Structural Impact review output

- Implement Structural Impact formatting for Review Details using bounded caller/dependent/file/test summaries plus unchanged-code evidence.
- Keep confidence language truthful for probable vs stronger graph evidence.
- Add formatter tests for bounded output and truncation behavior.

## Inputs

- `src/lib/review-utils.ts`
- `src/structural-impact/types.ts`
- `.gsd/milestones/M038/M038-CONTEXT.md`

## Expected Output

- `src/lib/structural-impact-formatter.ts`
- `src/lib/structural-impact-formatter.test.ts`
- `src/lib/review-utils.ts`

## Verification

bun test ./src/lib/structural-impact-formatter.test.ts && bun run tsc --noEmit

## Observability Impact

Adds explicit rendered-count and truncation metadata for Structural Impact output.
