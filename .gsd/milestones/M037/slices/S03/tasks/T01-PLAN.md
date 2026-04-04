---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Implement stale-model policy

- Finalize refresh cadence and stale-model handling for cached cluster models.
- Keep stale models usable only within bounded policy, then degrade to no-scoring.
- Add tests for fresh, stale, and missing-model paths.

## Inputs

- `src/knowledge/suggestion-cluster-refresh.ts`
- `src/knowledge/suggestion-cluster-store.ts`

## Expected Output

- `src/knowledge/suggestion-cluster-staleness.ts`
- `src/knowledge/suggestion-cluster-staleness.test.ts`

## Verification

bun test ./src/knowledge/suggestion-cluster-staleness.test.ts && bun run tsc --noEmit

## Observability Impact

Adds model-age, stale-use, and no-model fallback signals.
