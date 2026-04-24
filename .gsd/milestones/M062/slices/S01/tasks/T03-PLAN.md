---
estimated_steps: 4
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
  - observability
---

# T03: Ship a deterministic verifier for bounded first-pass versus dead-end failure

**Slice:** S01 — Bounded first-pass contract
**Milestone:** M062

## Description

Lock the slice with a dedicated proof surface modeled after the M048 verifier style, but scoped to this contract. Add a pure-code `verify:m062:s01` harness plus regression tests that classify representative scenarios such as timeout with checkpoint evidence, `max_turns` with checkpoint evidence, large-PR boundedness without timeout, and zero-evidence failure.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/lib/review-first-pass.ts` | Fail the verifier and tests immediately; do not paper over contract drift in report rendering. | N/A — pure local contract. | Emit a named invalid-payload status code instead of pretending the scenario passed. |
| `src/handlers/review.ts` scenario helpers / fixtures | Keep verifier scenarios local and deterministic; fail on drift instead of reaching into live GitHub state. | N/A — no live runtime calls allowed. | Report scenario-shape mismatch as explicit verifier failure. |
| `package.json` script wiring | Fail the dedicated test when `verify:m062:s01` is missing or points at the wrong entrypoint. | N/A. | Treat malformed `scripts` content as configuration drift and surface it in test output. |

## Load Profile

- **Shared resources**: local verifier script, package script wiring, and stable scenario fixtures.
- **Per-operation cost**: a handful of pure-code scenario evaluations and JSON/text rendering checks.
- **10x breakpoint**: report-shape drift and duplicated logic are the real risk; runtime cost stays trivial.

## Negative Tests

- **Malformed inputs**: unknown scenario id, invalid bounded reason, inconsistent coverage counts, and missing review-output identity fields.
- **Error paths**: package script missing, invalid CLI args, malformed normalized payload, and zero-evidence scenario incorrectly classified as bounded publication.
- **Boundary conditions**: timeout with checkpoint evidence, `max_turns` with checkpoint evidence, bounded large-PR without timeout, and failure with no trustworthy evidence.

## Steps

1. Add `scripts/verify-m062-s01.ts` with a local scenario matrix and stable status codes that classify bounded-first-pass publication versus dead-end failure from structured state.
2. Add `scripts/verify-m062-s01.test.ts` to cover report shape, scenario classification, human/JSON output, invalid args, and `package.json` script wiring.
3. Register `verify:m062:s01` in `package.json` and keep the CLI pure-code so it runs without GitHub or Azure dependencies.
4. Reuse the normalized first-pass contract instead of duplicating handler logic inside the verifier.

## Must-Haves

- [ ] `verify:m062:s01` emits stable scenario IDs and named status codes for bounded-first-pass versus dead-end failure.
- [ ] The verifier proves structured-state classification rather than relying only on brittle comment text.
- [ ] Dedicated tests cover CLI/report behavior and package-script wiring.

## Verification

- `bun test ./scripts/verify-m062-s01.test.ts`
- `bun run verify:m062:s01 -- --json`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: `verify:m062:s01` becomes the canonical bounded-first-pass proof surface with scenario IDs, status codes, bounded reason, evidence source, and coverage classification.
- How a future agent inspects this: run `bun run verify:m062:s01 -- --json` and compare the scenario matrix plus status codes.
- Failure state exposed: contract drift becomes visible as failing scenarios, invalid-payload status, or missing script wiring.

## Inputs

- `scripts/verify-m048-s01.ts` — reference verifier structure and CLI/report conventions.
- `package.json` — scripts table that must gain `verify:m062:s01`.
- `src/lib/review-first-pass.ts` — normalized contract used as the verifier’s truth source.
- `src/handlers/review.ts` — scenario semantics the verifier must protect against regression.
- `src/handlers/review-idempotency.ts` — stable publication-identity expectations.

## Expected Output

- `scripts/verify-m062-s01.ts` — pure-code bounded-first-pass verifier.
- `scripts/verify-m062-s01.test.ts` — regression suite for scenario classification and CLI/report behavior.
- `package.json` — canonical `verify:m062:s01` script wiring.
