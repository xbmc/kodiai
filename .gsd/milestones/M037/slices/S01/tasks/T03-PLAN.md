---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add model refresh entrypoint and proof harness

- Add the bounded background refresh entrypoint for cluster models.
- Keep refresh decoupled from the live review path.
- Add a verifier proving cached models are built and read without per-review rebuilds.

## Inputs

- `src/knowledge/suggestion-cluster-builder.ts`
- `src/knowledge/wiki-update-generator.ts`
- `.gsd/milestones/M037/M037-CONTEXT.md`

## Expected Output

- `src/knowledge/suggestion-cluster-refresh.ts`
- `src/knowledge/suggestion-cluster-refresh.test.ts`
- `scripts/verify-m037-s01.ts`
- `scripts/verify-m037-s01.test.ts`

## Verification

bun test ./src/knowledge/suggestion-cluster-refresh.test.ts && bun test ./scripts/verify-m037-s01.test.ts

## Observability Impact

Adds refresh totals and cache-read proof signals.
