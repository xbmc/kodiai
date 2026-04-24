# S01: Composed rollout verifier

**Goal:** Ship a top-level `verify:m065` proof harness that composes the authoritative M062, M063, and M064 verifier families into one milestone-level verdict without flattening their nested evidence, while also reserving explicit machine-readable slots for the live-proof and fresh-regression obligations that later slices will satisfy.
**Demo:** `bun run verify:m065 -- --json` returns one milestone-level verdict while preserving attributable nested evidence from M062, M063, and M064, with stable check IDs and drill-down pointers instead of a flattened summary.

## Must-Haves

- `bun run verify:m065 -- --json` emits a stable report with top-level check IDs, an overall verdict, drill-down pointers, and intact nested reports for `verify:m062:s03`, `verify:m063:s03`, and `verify:m064:s03`.
- The composed verifier fails on malformed or failing nested reports, but does not invent new authority by recomputing M062/M063/M064 conclusions from scratch.
- The report shape exposes explicit pending/skipped rollout obligations for the M065 live proof and fresh non-large regression proof so a partial slice cannot go falsely green on historical evidence alone.
- Human-readable output names the failing nested contract and the command or identifier an operator should run next to drill down.

## Proof Level

- This slice proves: This slice proves: final-assembly
- Real runtime required: no
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `scripts/verify-m062-s03.ts`, `scripts/verify-m063-s03.ts`, `scripts/verify-m064-s03.ts`, `package.json` script wiring conventions.
- New wiring introduced in this slice: a composed `scripts/verify-m065.ts` entrypoint plus shared report-composition helpers/tests that preserve nested evidence and expose drill-down metadata.
- What remains before the milestone is truly usable end-to-end: S02 must populate the live large-PR proof slot with real runtime evidence, and S03 must populate the fresh non-large regression slot plus operator rerun packaging.

## Verification

- Runtime signals: `verify:m065` top-level status codes plus per-check drill-down metadata keyed to nested verifier commands.
- Inspection surfaces: `bun run verify:m065 -- --json`, human-readable report output, and preserved nested report payloads.
- Failure visibility: top-level failing check id, nested failing status codes, and pending-versus-failed rollout obligation state remain explicit.
- Redaction constraints: only verifier metadata, commands, and stable identifiers; no secrets or live tokens.

## Tasks

- [x] **T01: Define the M065 composed report contract and failing composition tests** `est:1h`
  Expected executor skills: `test-driven-development`, `systematic-debugging`, `verify-before-complete`.

Write the failing contract tests first. Steps:
1. Add `scripts/verify-m065.test.ts` covering parse args, stable top-level check ids, JSON shape, human output, nested report preservation, and package script wiring.
2. In those tests, stub the M062/M063/M064 evaluators so the M065 harness is forced to treat their reports as authoritative nested payloads rather than recomputing their conclusions.
3. Add negative tests for malformed nested reports, nested failures, and the case where live-proof/regression obligations are still pending so the top-level verifier stays honest about incomplete rollout proof.
4. Assert that the human report names the failing nested contract and points to the next drill-down command, not just a flattened summary.

Must-haves:
- Top-level checks include one per nested prerequisite plus explicit M065 live-proof and fresh-regression obligation checks.
- JSON report preserves intact nested report objects for M062/M063/M064 and exposes machine-readable drill-down metadata.
- Pending future obligations are modeled as data/skipped checks, not silently omitted.

Verification:
- `bun test scripts/verify-m065.test.ts`
- `bun test scripts/verify-m065.test.ts -t "stable top-level check ids"`

Done when:
- The new test file fails before implementation and fully describes the composed verifier contract with no placeholder assertions.
  - Files: `scripts/verify-m065.test.ts`, `scripts/verify-m065.ts`, `package.json`
  - Verify: bun test scripts/verify-m065.test.ts

- [ ] **T02: Implement `verify:m065` composition, CLI, and drill-down metadata** `est:1h`
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
  - Files: `scripts/verify-m065.ts`, `scripts/verify-m065.test.ts`, `package.json`
  - Verify: bun test scripts/verify-m065.test.ts && bun run verify:m065 -- --json

## Files Likely Touched

- scripts/verify-m065.test.ts
- scripts/verify-m065.ts
- package.json
