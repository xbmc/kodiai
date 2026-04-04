---
estimated_steps: 6
estimated_files: 1
skills_used: []
---

# T02: Update handler review test expectations for the new usage format

Check whether `src/handlers/review.test.ts` contains any expectations about the Claude usage line format and update them to the percent-left contract.

Steps:
1. Run `grep -n 'seven_day\|pct\|percent\|usage.*limit\|limit.*usage\|Claude Code usage' src/handlers/review.test.ts` to find any usage-line assertions.
2. If present, update each to match `XX% of seven_day limit remaining`.
3. Run `bun test ./src/handlers/review.test.ts` and confirm all pass.
4. Run `bun run tsc --noEmit` for the full type gate.

## Inputs

- ``src/handlers/review.test.ts``
- ``src/lib/review-utils.ts``

## Expected Output

- ``src/handlers/review.test.ts``

## Verification

bun test ./src/handlers/review.test.ts && bun run tsc --noEmit
