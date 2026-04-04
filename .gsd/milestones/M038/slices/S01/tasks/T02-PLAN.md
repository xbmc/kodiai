---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T02: Build structural-impact orchestration with cache and timeout

- Implement orchestration that queries graph blast radius and canonical current-code evidence together.
- Add timeout, partial-result, and cache-reuse behavior at the orchestration boundary.
- Keep the result bounded before any formatting logic runs.

## Inputs

- `src/structural-impact/adapters.ts`
- `src/handlers/review.ts`
- `.gsd/milestones/M038/M038-CONTEXT.md`

## Expected Output

- `src/structural-impact/orchestrator.ts`
- `src/structural-impact/orchestrator.test.ts`

## Verification

bun test ./src/structural-impact/orchestrator.test.ts

## Observability Impact

Adds timing, cache-hit, timeout, and partial-result signals for structural-impact fetches.
