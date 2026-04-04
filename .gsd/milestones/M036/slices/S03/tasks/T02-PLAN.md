---
estimated_steps: 3
estimated_files: 3
skills_used: []
---

# T02: Add lifecycle notifications

- Add bounded activation/retirement notifications and logs for operator visibility.
- Reuse existing background-sweep patterns and keep notifications fail-open.
- Add tests or stubs proving notification does not block lifecycle transitions.

## Inputs

- `src/knowledge/generated-rule-sweep.ts`
- `src/knowledge/wiki-update-generator.ts`

## Expected Output

- `src/knowledge/generated-rule-notify.ts`
- `src/knowledge/generated-rule-notify.test.ts`

## Verification

bun test ./src/knowledge/generated-rule-notify.test.ts

## Observability Impact

Adds operator-visible activation/retirement event surfaces.
