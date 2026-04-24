---
estimated_steps: 9
estimated_files: 5
skills_used:
  - test-driven-development
  - verify-before-complete
  - writing-plans
---

# T03: Add deterministic proof for same-surface continuation revisions

Lock the shipped S02 contract with a deterministic verifier and package wiring so future slices can detect regressions in public-surface ownership, explicit revisions, and quiet no-delta settlement.

Steps:
1. Model an S02 scenario matrix in a new verifier script that exercises the production formatter/publication seams for timeout first pass, merge continuation, explicit revisions, and no-delta settlement.
2. Add verifier tests for CLI args, scenario status codes, contract failures, and human-readable report output, mirroring existing M062/M063 verifier style.
3. Wire the verifier into `package.json` and finish with a focused end-to-end verification run across formatter, handler, verifier, and TypeScript diagnostics if available.

Must-haves:
- The verifier reports whether continuation stayed on one visible surface, rendered explicit revisions, and avoided public churn on no-delta settlement.
- Test coverage fails if the canonical comment loses marker continuity or if a second lifecycle comment reappears.
- Package scripts expose `verify:m063:s02` for milestone-level proof.

## Inputs

- ``scripts/verify-m062-s03.ts``
- ``scripts/verify-m062-s03.test.ts``
- ``scripts/verify-m063-s01.ts``
- ``scripts/verify-m063-s01.test.ts``
- ``package.json``
- ``src/handlers/review.test.ts``
- ``src/lib/partial-review-formatter.test.ts``

## Expected Output

- ``scripts/verify-m063-s02.ts``
- ``scripts/verify-m063-s02.test.ts``
- ``package.json``

## Verification

bun test ./scripts/verify-m063-s02.test.ts && bun run verify:m063:s02 -- --json && bun run tsc --noEmit

## Observability Impact

- Adds a deterministic inspection surface for same-surface lifecycle state and revision visibility.
- Gives future slices a single `verify:m063:s02` command to localize whether regressions are in ownership, revision rendering, or quiet settlement.
