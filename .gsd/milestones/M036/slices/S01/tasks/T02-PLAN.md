---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T02: Generate pending rule proposals from clustered feedback

- Build proposal-candidate generation from clustered positive learning-memory patterns.
- Reuse existing cluster-matcher and cluster-pipeline helpers where they fit.
- Bound cluster minimums and proposal text inputs so sparse/noisy patterns do not generate rules.

## Inputs

- `src/knowledge/cluster-matcher.ts`
- `src/knowledge/cluster-pipeline.ts`
- `src/knowledge/memory-store.ts`

## Expected Output

- `src/knowledge/generated-rule-proposals.ts`
- `src/knowledge/generated-rule-proposals.test.ts`

## Verification

bun test ./src/knowledge/generated-rule-proposals.test.ts

## Observability Impact

Adds cluster-size, proposal-count, and skipped-cluster signals.
