---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T02: Integrate graph signals into extensive-review selection

- Extend large-PR review selection to consume graph signals alongside current file-risk scoring.
- Keep the existing non-graph path as the fallback and preserve bounded ranking behavior.
- Wire graph-aware selection into the review handler before prompt packing.

## Inputs

- `src/lib/file-risk-scorer.ts`
- `src/handlers/review.ts`
- `src/review-graph/query.ts`

## Expected Output

- `src/lib/file-risk-scorer.ts`
- `src/handlers/review.ts`
- `src/lib/file-risk-scorer.test.ts`

## Verification

bun test ./src/lib/file-risk-scorer.test.ts

## Observability Impact

Adds graph-hit and graph-ranked-selection counters to large-review execution.
