---
estimated_steps: 3
estimated_files: 5
skills_used: []
---

# T03: Add refresh and fail-open verifier

- Add the milestone-level verifier covering cache reuse, refresh, staleness, and fail-open review completion.
- Keep proof output stable enough to close M037 without hand inspection.
- Cover the path where the review falls back to the naive behavior.

## Inputs

- `src/knowledge/suggestion-cluster-refresh.ts`
- `src/knowledge/suggestion-cluster-degradation.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M037/M037-CONTEXT.md`

## Expected Output

- `scripts/verify-m037-s03.ts`
- `scripts/verify-m037-s03.test.ts`

## Verification

bun test ./scripts/verify-m037-s03.test.ts && bun run verify:m037:s03 -- --json

## Observability Impact

Provides stable proof IDs for refresh, cache reuse, and fail-open scoring behavior.
