---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Build positive/negative cluster models

- Build per-repo positive/negative cluster model generation from learning memories.
- Reuse existing clustering helpers and enforce minimum-member thresholds.
- Add tests for centroid generation and bounded model shape.

## Inputs

- `src/knowledge/cluster-matcher.ts`
- `src/knowledge/cluster-pipeline.ts`
- `src/knowledge/memory-store.ts`

## Expected Output

- `src/knowledge/suggestion-cluster-builder.ts`
- `src/knowledge/suggestion-cluster-builder.test.ts`

## Verification

bun test ./src/knowledge/suggestion-cluster-builder.test.ts

## Observability Impact

Adds model-build counts, positive/negative cluster counts, and skipped-cluster signals.
