---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Finalize the milestone-level verifier command and output contract

Promote the current slice-level verifier into the final milestone operator command. Add a final `verify:m044` package script (keeping the slice-level script only if it still adds value), tighten the output contract around milestone-level summary counts and verdict breakdowns, and add tests that pin the final command name and JSON/human report shape.

## Inputs

- `scripts/verify-m044-s01.ts`
- `scripts/verify-m044-s01.test.ts`
- `package.json`

## Expected Output

- `scripts/verify-m044-s01.ts`
- `scripts/verify-m044-s01.test.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m044-s01.test.ts && bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json

## Observability Impact

Creates the stable milestone-level command surface operators will actually use, with clear summary counts and verdict breakdowns.
