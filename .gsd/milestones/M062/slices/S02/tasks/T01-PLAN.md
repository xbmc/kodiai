---
estimated_steps: 4
estimated_files: 5
skills_used:
  - using-superpowers
  - writing-plans
  - test-driven-development
  - verify-before-complete
---

# T01: Lock the visible-state wording contract in formatter tests and shared helpers

**Slice:** S02 — Coverage and visible-state rendering
**Milestone:** M062

## Description

Define the visible bounded-first-pass contract at the formatter seam before touching handler branches. The goal is to freeze one shared story for covered scope, remaining scope, bounded reason, and continuation state so later handler wiring cannot reintroduce wording drift.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/lib/review-first-pass.ts` payload contract | Stop and align tests/helpers to the actual normalized payload instead of inventing new fields. | N/A for pure module work. | Add or update guard coverage so renderers degrade to truthful bounded wording instead of guessing missing scope. |
| Existing formatter tests in `src/lib/review-utils.test.ts` and `src/lib/partial-review-formatter.test.ts` | Treat unexpected failures as contract drift that must be resolved before moving to handler work. | N/A for local unit tests. | Replace brittle string expectations with assertions against the intended shared wording primitives only where the product contract truly changes. |

## Negative Tests

- **Malformed inputs**: cover bounded-first-pass payloads with missing `coveredScope`, missing `remainingScope`, and zero-evidence failure so helpers never imply exhaustive coverage.
- **Error paths**: verify non-publishable / zero-evidence states keep explicit ineligible or hard-failure wording rather than flowing through bounded-success copy.
- **Boundary conditions**: assert continuation wording for both `continuationPending: true` and `continuationPending: false` when remaining scope is present or absent.

## Steps

1. Expand `src/lib/review-utils.test.ts` and `src/lib/partial-review-formatter.test.ts` to describe the shared visible-state contract for timeout, max-turns, and zero-evidence cases.
2. Refactor `src/lib/review-utils.ts` to expose shared wording primitives or line builders that encode coverage, remaining scope, and continuation state once.
3. Update `src/lib/partial-review-formatter.ts` to consume the shared wording helper rather than maintaining separate summary prose.
4. Run the formatter test files and keep iterating until they pass with the new contract.

## Must-Haves

- [ ] Formatter tests clearly lock the bounded visible-state contract before any handler work.
- [ ] Shared helper logic in `src/lib/review-utils.ts` becomes the only source of bounded-first-pass wording used by formatters.

## Verification

- `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`
- Confirm the assertions cover timeout, max-turns, zero-evidence, and continuation-state wording explicitly.

## Observability Impact

- Signals added/changed: unit-test assertions become the stable signal for visible-state wording drift.
- How a future agent inspects this: run `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`.
- Failure state exposed: mismatched coverage or continuation wording fails at the formatter seam before handler paths are involved.

## Inputs

- `src/lib/review-utils.ts` — current detail-line and summary-clause rendering.
- `src/lib/review-utils.test.ts` — existing formatter expectations that need to become the new contract proof.
- `src/lib/partial-review-formatter.ts` — bounded public comment renderer that should stop carrying bespoke prose.
- `src/lib/partial-review-formatter.test.ts` — current bounded comment string coverage.
- `src/lib/review-first-pass.ts` — normalized payload fields that constrain what wording is legitimate.

## Expected Output

- `src/lib/review-utils.ts` — shared visible-state wording helpers or line builders.
- `src/lib/review-utils.test.ts` — unit coverage for coherent coverage/remaining/continuation wording.
- `src/lib/partial-review-formatter.ts` — public bounded comment renderer using shared wording.
- `src/lib/partial-review-formatter.test.ts` — updated comment assertions matching the shared contract.
