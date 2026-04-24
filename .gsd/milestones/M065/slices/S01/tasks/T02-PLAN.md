---
estimated_steps: 16
estimated_files: 3
skills_used: []
---

# T02: Implement `verify:m065` composition, CLI, and drill-down metadata

Expected executor skills: `test-driven-development`, `systematic-debugging`, `verify-before-complete`.

Implement the composed verifier against the contract from T01. Steps:
1. Add `scripts/verify-m065.ts` with a typed report/check model, stable `verify:m065` CLI parsing, and a build/evaluate/render flow matching existing verifier conventions.
2. Call the exported evaluators from `verify-m062-s03`, `verify-m063-s03`, and `verify-m064-s03`; validate their minimal contract shape; fail loudly if a nested report is malformed or red; and retain the raw nested report objects in the final JSON.
3. Add explicit top-level checks and report sections for `liveLargePrProof` and `freshRegressionProof` as pending/skipped placeholders with drill-down pointers to the future proof sources so the milestone cannot go false-green before S02/S03.
4. Render a human report that surfaces overall verdict, nested pass/fail state, failing check ids, and next drill-down commands/identifiers for operators.
5. Wire `package.json` to expose `verify:m065`.

Must-haves:
- `bun run verify:m065 -- --json` works and returns a machine-readable report with nested evidence intact.
- Overall pass/fail is derived from named top-level checks, not ad hoc prose.
- R069 remains visible as an unsatisfied/pending rollout obligation until fresh regression evidence exists; the verifier must not imply that older historical validation is enough for M065 closeout.

Verification:
- `bun test scripts/verify-m065.test.ts`
- `bun run verify:m065 -- --json`

Done when:
- The new command runs from `package.json`, preserves attributable nested evidence, and reports pending live/regression obligations without flattening or overclaiming rollout success.

## Inputs

- ``scripts/verify-m065.test.ts``
- ``scripts/verify-m062-s03.ts``
- ``scripts/verify-m063-s03.ts``
- ``scripts/verify-m064-s03.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m065.ts``
- ``package.json``

## Verification

bun test scripts/verify-m065.test.ts && bun run verify:m065 -- --json

## Observability Impact

Adds the operator inspection surface for milestone rollout state: top-level status, failing check ids, drill-down commands, and pending rollout obligations become visible from one command.
