---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add scoring and review-path verifier

- Add a verifier showing cached cluster models change the final finding set or confidence compared with the naive path.
- Keep proof output machine-checkable and bounded.
- Cover safety-guarded CRITICAL finding behavior.

## Inputs

- `src/knowledge/suggestion-cluster-scoring.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M037/M037-CONTEXT.md`

## Expected Output

- `scripts/verify-m037-s02.ts`
- `scripts/verify-m037-s02.test.ts`

## Verification

bun test ./scripts/verify-m037-s02.test.ts && bun run verify:m037:s02 -- --json

## Observability Impact

Produces stable proof output for thematic scoring behavior.
