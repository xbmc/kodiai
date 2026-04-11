---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Lock the integrated verifier with drift-focused regression tests

**Slice:** S03 — Integrated M047 coherence verifier
**Milestone:** M047

## Description

Turn the new milestone-close harness into a durable regression surface. The integrated report only matters if scenario mapping, nested evidence preservation, CLI behavior, and script wiring fail loudly when they drift, so this task pins those seams with focused tests rather than snapshot-heavy broad coverage.

## Steps

1. Create `scripts/verify-m047.test.ts` with module-loading helpers, expected top-level check ids, and a happy-path test that exercises the real nested evaluators.
2. Assert that the happy path preserves nested S02, M045, and M046 evidence, emits the five milestone scenario ids, anchors `calibrated-retained` on `koprajs`, anchors `stale-degraded` on `fkoemep`, and reports coarse-fallback Slack/profile continuity as not applicable.
3. Add injected malformed and failing prerequisite-report cases, missing-scenario-evidence cases, invalid-arg handling, and human-versus-JSON output alignment checks so the harness cannot go false-green.
4. Assert `package.json` script wiring for `verify:m047` and run the dedicated verifier test, prerequisite proof scripts, and `bun run tsc --noEmit` as the slice-close bundle.

## Must-Haves

- [ ] `scripts/verify-m047.test.ts` proves the integrated happy path with real nested evaluators and stable top-level check ids.
- [ ] The regression suite fails on malformed prerequisite evidence, failed prerequisite reports, missing milestone scenario evidence, invalid CLI args, and package-script drift.
- [ ] The slice-close bundle keeps `verify:m047`, `verify:m047:s02`, `verify:m045:s03`, `verify:m046`, and TypeScript checking aligned on the same milestone-close proof surface.

## Verification

- `bun test ./scripts/verify-m047.test.ts`
- `bun run verify:m047 -- --json && bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json && bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: regression tests pin top-level check ids, scenario anchors, human/JSON output alignment, and package wiring as durable proof-surface diagnostics.
- How a future agent inspects this: run `bun test ./scripts/verify-m047.test.ts` first, then `bun run verify:m047 -- --json` for the full scenario payload.
- Failure state exposed: scenario drift, invalid CLI behavior, missing nested evidence, or mismatched script wiring breaks a named test before the milestone-close command can go false-green.

## Inputs

- `scripts/verify-m047.ts` — new integrated harness under test.
- `scripts/verify-m047-s02.ts` — nested downstream truth report that the integrated harness must preserve.
- `scripts/verify-m045-s03.ts` — nested contributor-experience contract guard that still needs to stay green.
- `scripts/verify-m046.ts` — nested calibration verdict/change-contract report that must remain visible as data.
- `package.json` — script contract that should expose `verify:m047`.

## Expected Output

- `scripts/verify-m047.test.ts` — focused regression suite for happy path, malformed inputs, failure states, and CLI/output drift.
- `scripts/verify-m047.ts` — any harness adjustments needed to satisfy the new regression coverage.
- `package.json` — verified `verify:m047` script wiring that matches the test expectations.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m047.ts` | Keep the regression suite red until top-level check ids, scenario ids, and exit semantics match the planned contract. | N/A — local test execution only. | Treat malformed human/JSON output and missing scenario summaries as assertion failures, not snapshot updates. |
| `package.json` script wiring | Fail the suite immediately if `verify:m047` is absent or points at the wrong script entrypoint. | N/A | Treat a malformed `scripts` object or mismatched command string as configuration drift. |
| Injected nested-report doubles in `scripts/verify-m047.test.ts` | Use them to force malformed and failing prerequisite states so the harness proves non-zero exits and named failing checks. | N/A | Reject doubles that omit the fields needed to model realistic prerequisite drift; the tests should assert on those malformed cases directly. |

## Load Profile

- **Shared resources**: Bun test runner, imported verifier modules, and the `package.json` script contract.
- **Per-operation cost**: one focused verifier test file plus the prerequisite proof commands and a TypeScript check.
- **10x breakpoint**: overly broad fixtures or snapshot-style assertions would make failures unreadable before runtime cost becomes material, so the test file should stay focused on named checks, scenario anchors, and exit behavior.

## Negative Tests

- **Malformed inputs**: nested prerequisite reports with missing `checks`, missing `scenarios`, missing verdict/change-contract fields, or wrong scenario ids; unknown CLI flags.
- **Error paths**: prerequisite proof failure, malformed prerequisite evidence, missing calibrated/stale anchors, mismatched human vs JSON output, and missing `verify:m047` package wiring.
- **Boundary conditions**: happy-path composition with real nested evaluators, `coarse-fallback` reporting Slack/profile continuity as not applicable, `calibrated-retained` preserving both S02 and M046 evidence, and `stale-degraded` preserving degraded runtime plus M046 stale-row evidence.
