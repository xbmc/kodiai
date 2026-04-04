---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Finalize cache and timeout behavior

- Finalize structural-impact cache policy keyed by repo/base/head and integrate explicit timeout handling.
- Ensure repeated review requests reuse cached combined structural-impact results.
- Add tests for timeout, cache-hit, and partial-result behavior.

## Inputs

- `src/structural-impact/orchestrator.ts`
- `src/handlers/review.ts`

## Expected Output

- `src/structural-impact/cache.ts`
- `src/structural-impact/cache.test.ts`
- `src/structural-impact/orchestrator.ts`

## Verification

bun test ./src/structural-impact/cache.test.ts && bun run tsc --noEmit

## Observability Impact

Adds cache-hit/miss, timeout, and partial-result accounting for structural-impact fetches.
