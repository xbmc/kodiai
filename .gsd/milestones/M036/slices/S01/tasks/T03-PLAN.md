---
estimated_steps: 3
estimated_files: 4
skills_used: []
---

# T03: Add proposal sweep and proof harness

- Add the sweep entrypoint that reads learning memories, produces proposal candidates, and persists pending rules.
- Keep the sweep fail-open and background-oriented.
- Add a verifier proving proposals are created from representative positive clusters.

## Inputs

- `src/knowledge/generated-rule-proposals.ts`
- `src/knowledge/wiki-update-generator.ts`
- `.gsd/milestones/M036/M036-CONTEXT.md`

## Expected Output

- `src/knowledge/generated-rule-sweep.ts`
- `src/knowledge/generated-rule-sweep.test.ts`
- `scripts/verify-m036-s01.ts`
- `scripts/verify-m036-s01.test.ts`

## Verification

bun test ./src/knowledge/generated-rule-sweep.test.ts && bun test ./scripts/verify-m036-s01.test.ts

## Observability Impact

Adds sweep-level proposal totals and fail-open warning signals.
