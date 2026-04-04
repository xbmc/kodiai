---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T02: Harden fail-open scoring degradation

- Harden fail-open behavior so unavailable cluster models or scoring failures never block review completion.
- Ensure user-visible output does not pretend a boost or suppression happened when scoring was skipped.
- Add degradation tests across each failure mode.

## Inputs

- `src/handlers/review.ts`
- `src/knowledge/suggestion-cluster-scoring.ts`

## Expected Output

- `src/knowledge/suggestion-cluster-degradation.ts`
- `src/knowledge/suggestion-cluster-degradation.test.ts`

## Verification

bun test ./src/knowledge/suggestion-cluster-degradation.test.ts

## Observability Impact

Adds explicit degradation-reason surfaces for scoring skip paths.
