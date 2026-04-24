---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T01: Pin the `verify:m065:s02` contract with failing tests and CLI wiring

**Slice:** S02 — Representative live large-PR proof
**Milestone:** M065

## Description

Create the dedicated live-proof verifier contract before implementation logic spreads across the repo. This task defines the `verify:m065:s02` CLI surface, report keys, and stable check ids around an explicit operator-provided proof target. The verifier validates one captured live run; it does not discover PRs on its own.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m048-s01.ts` contract | Fail the contract test and pin the mismatch in `scripts/verify-m065-s02.test.ts` before implementing composition | Not applicable in unit tests | Treat as nested contract drift and require an explicit test expectation |
| `scripts/verify-m049-s02.ts` contract | Fail the contract test and keep the S02 report schema separate from M049 internals | Not applicable in unit tests | Add a failing test proving S02 surfaces malformed nested evidence truthfully |
| `scripts/verify-m064-s03.ts` contract | Fail the contract test and document the expected operator-evidence handoff in the test fixture | Not applicable in unit tests | Add a failing test that blocks flattening or omission of operator-evidence fields |

## Load Profile

- **Shared resources**: CI test time and module mocking only.
- **Per-operation cost**: One new verifier entrypoint and one focused test file.
- **10x breakpoint**: Assertion drift if stable check ids or report keys are left implicit.

## Negative Tests

- **Malformed inputs**: missing `--review-output-key`, malformed review-output key, malformed `--repo`, and explicit `--delivery-id` mismatch.
- **Error paths**: injected malformed nested subproof blocks and unknown CLI flags.
- **Boundary conditions**: optional `--delivery-id` omitted, optional `--repo` omitted, and `--json` / `--help` parsing.

## Steps

1. Add `scripts/verify-m065-s02.test.ts` with failing coverage for CLI parsing, stable check ids, required report keys, invalid-arg handling, and package script wiring.
2. Scaffold `scripts/verify-m065-s02.ts` with the minimum exported types/functions needed for the tests to compile, plus usage text and a JSON-capable `main()`.
3. Wire `verify:m065:s02` into `package.json` and make the contract tests pass without yet implementing the full live-proof composition.
4. Keep the report centered on explicit identifiers and nested subproof slots so T02 can add real evidence without changing the contract.

## Must-Haves

- [ ] `scripts/verify-m065-s02.test.ts` fails first and then passes with pinned stable CLI/report semantics.
- [ ] `scripts/verify-m065-s02.ts` exports the parser/evaluator/renderer/main seams T02 will implement against.
- [ ] `package.json` includes `verify:m065:s02` wired to `bun scripts/verify-m065-s02.ts`.

## Verification

- `bun test scripts/verify-m065-s02.test.ts`
- `bun test scripts/verify-m065-s02.test.ts --filter "invalid arg"`

## Observability Impact

- Signals added/changed: the existence of a dedicated live-proof report surface with stable top-level check ids and nested report keys.
- How a future agent inspects this: `bun run verify:m065:s02 -- --help` and `bun test scripts/verify-m065-s02.test.ts`.
- Failure state exposed: contract drift in CLI args, report keys, or package script wiring.

## Inputs

- `scripts/verify-m048-s01.ts` — reference live phase-timing verifier CLI and report conventions.
- `scripts/verify-m049-s02.ts` — reference explicit visible-review proof contract and error reporting.
- `scripts/verify-m064-s03.ts` — reference canonical operator-evidence report shape.
- `scripts/verify-m065.ts` — reference top-level rollout obligation/check-id composition pattern.
- `package.json` — existing verifier script wiring conventions.

## Expected Output

- `scripts/verify-m065-s02.ts` — new verifier entrypoint with pinned exported contract.
- `scripts/verify-m065-s02.test.ts` — failing-then-passing contract coverage for S02 CLI/report semantics.
- `package.json` — new `verify:m065:s02` script entry.
