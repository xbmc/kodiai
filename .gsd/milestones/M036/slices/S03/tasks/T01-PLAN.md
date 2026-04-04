---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T01: Implement rule retirement policy

- Implement retirement policy for active rules when recent negative signal or decay crosses the configured floor.
- Keep retirement state explicit and reversible only through future regeneration.
- Add tests for active -> retired transitions.

## Inputs

- `src/knowledge/generated-rule-store.ts`
- `.gsd/milestones/M036/M036-CONTEXT.md`

## Expected Output

- `src/knowledge/generated-rule-retirement.ts`
- `src/knowledge/generated-rule-retirement.test.ts`

## Verification

bun test ./src/knowledge/generated-rule-retirement.test.ts && bun run tsc --noEmit

## Observability Impact

Adds retirement decisions and decay-threshold signals.
