---
estimated_steps: 30
estimated_files: 4
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T02: Add an S03 verifier that proves bounded continuation without exaggeration

Package the S03 proof into a deterministic verifier script that mirrors the S01/S02 proof style: build first-pass and continuation prompt evidence from tracked fixtures, report section-level narrowing and sufficiency checks, and wire a `verify:m063:s03` script plus verifier tests. The verifier should be strict enough to fail when continuation replays first-pass breadth or loses required boundedness truthfulness, but it must stay honest about what it proves: narrower/sufficient-than-first-pass continuation, not exhaustive eventual coverage.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Prompt comparison helper from T01 | Bubble the helper failure into a contract-failed verifier result with the scenario/check name. | N/A; verifier is pure and local. | Treat malformed section data as a failed check and record it in `issues`. |
| CLI/report wiring in `package.json` | Fail the verifier test that checks script wiring so execution cannot silently skip the proof. | N/A. | Report invalid args with an explicit `m063_s03_invalid_arg` status code and usage text. |

## Load Profile

- **Shared resources**: None; verifier remains pure and file-local.
- **Per-operation cost**: A small fixed scenario matrix with prompt builds and summary/report rendering.
- **10x breakpoint**: Report verbosity, not compute, so keep scenarios narrowly tied to R066 and authority-safe proof.

## Negative Tests

- **Malformed inputs**: invalid scenario id, missing required prompt sections, or an empty continuation file subset should fail deterministically.
- **Error paths**: package-script drift, contract-failed scenario mutation, or widened continuation metrics should turn the verifier red.
- **Boundary conditions**: include a scenario where continuation stays narrower but quiet/no-delta semantics still avoid overclaiming exhaustive coverage.

## Steps

1. Model a small S03 scenario matrix covering large-PR first-pass vs continuation prompt comparison plus truthful boundedness reporting.
2. Implement `scripts/verify-m063-s03.ts` to evaluate the matrix, emit human and JSON reports, and return dedicated status codes for invalid args vs contract failure.
3. Add `scripts/verify-m063-s03.test.ts` coverage for scenario rendering, failure injection, and `package.json` script wiring.
4. Wire `package.json` with `verify:m063:s03` and keep the report language explicit about sufficient-but-bounded rather than exhaustive coverage.

## Must-Haves

- [ ] `verify:m063:s03` reports section-level narrowing evidence and boundedness wording checks using tracked fixtures only.
- [ ] Verifier output stays truthful about sufficiency and does not claim exhaustive review completion.
- [ ] Package/test wiring makes the verifier part of repeatable slice-close evidence.

## Verification

- `bun test scripts/verify-m063-s03.test.ts`
- `bun run verify:m063:s03 -- --json`

## Observability Impact

- Signals added/changed: new verifier status codes and per-scenario checks for narrowing, boundedness truthfulness, and contract drift.
- How a future agent inspects this: run `bun run verify:m063:s03 -- --json` and inspect `issues` plus failing check keys.
- Failure state exposed: which scenario/check stopped proving bounded continuation.

## Inputs

- ``src/execution/review-prompt.test.ts``
- ``scripts/verify-m063-s02.ts``
- ``scripts/verify-m063-s02.test.ts``
- ``package.json``

## Expected Output

- ``scripts/verify-m063-s03.ts``
- ``scripts/verify-m063-s03.test.ts``
- ``package.json``

## Verification

bun test scripts/verify-m063-s03.test.ts && bun run verify:m063:s03 -- --json

## Observability Impact

Creates the durable machine-readable proof surface for slice close and future milestone validation.
