---
estimated_steps: 3
estimated_files: 5
skills_used: []
---

# T03: Add fail-open and cache-reuse verifier

- Add the milestone-level verifier covering success, cache reuse, timeout, and substrate-failure paths.
- Prove the review completes without blocking, Structural Impact stays bounded, and breaking-change output only claims what the evidence supports.
- Keep proof output stable enough to close M038 without hand inspection.

## Inputs

- `src/structural-impact/cache.ts`
- `src/structural-impact/degradation.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M038/M038-CONTEXT.md`

## Expected Output

- `scripts/verify-m038-s03.ts`
- `scripts/verify-m038-s03.test.ts`

## Verification

bun test ./scripts/verify-m038-s03.test.ts && bun run verify:m038:s03 -- --json

## Observability Impact

Provides stable proof IDs for cache reuse, timeout, and truthful degradation.
