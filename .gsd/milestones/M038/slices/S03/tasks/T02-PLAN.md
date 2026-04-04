---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Harden fail-open degradation paths

- Harden degradation behavior so missing graph data, missing corpus data, or total substrate failure never blocks review completion.
- Ensure the user-visible output stays truthful: no invented caller counts or fake structural certainty.
- Add tests for graceful fallback across each failure mode.

## Inputs

- `src/handlers/review.ts`
- `src/lib/structural-impact-formatter.ts`
- `src/structural-impact/orchestrator.ts`

## Expected Output

- `src/structural-impact/degradation.ts`
- `src/structural-impact/degradation.test.ts`
- `src/handlers/review.ts`

## Verification

bun test ./src/structural-impact/degradation.test.ts

## Observability Impact

Adds explicit degradation-reason signals and truthful fallback-state output.
