---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T03: Add review-path integration seam

- Add a review-path integration seam that lets the handler request structural-impact data through the new orchestration layer.
- Keep the integration behind a single module boundary so later substrate API changes do not sprawl through `review.ts`.
- Add tests using stubbed graph/corpus adapters.

## Inputs

- `src/structural-impact/orchestrator.ts`
- `src/handlers/review.ts`

## Expected Output

- `src/structural-impact/review-integration.ts`
- `src/structural-impact/review-integration.test.ts`

## Verification

bun test ./src/structural-impact/review-integration.test.ts

## Observability Impact

Keeps structural-impact fetch decisions and degradation surfaces localized.
