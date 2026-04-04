---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Integrate thematic scoring into review generation

- Wire cluster scoring into the review pipeline before comment creation.
- Reuse safety-guard and confidence-adjuster paths instead of inventing parallel logic.
- Add tests proving CRITICAL findings bypass suppression and lower-severity findings can be adjusted.

## Inputs

- `src/handlers/review.ts`
- `src/feedback/confidence-adjuster.ts`
- `src/feedback/safety-guard.ts`
- `src/knowledge/suggestion-cluster-scoring.ts`

## Expected Output

- `src/handlers/review.ts`
- `src/feedback/confidence-adjuster.ts`
- `src/feedback/confidence-adjuster.test.ts`

## Verification

bun test ./src/feedback/confidence-adjuster.test.ts

## Observability Impact

Adds score-source, safety-bypass, and suppression-count signals in live review execution.
