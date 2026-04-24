---
estimated_steps: 4
estimated_files: 5
skills_used:
  - using-superpowers
  - writing-plans
  - test-driven-development
  - verify-before-complete
---

# T02: Make Review Details and bounded comments render the same coverage and continuation story

**Slice:** S02 — Coverage and visible-state rendering
**Milestone:** M062

## Description

Wire the shared wording contract into both visible surfaces. This task closes the core product gap called out in research: `formatReviewDetailsSummary()` must stop letting timeout-only lines replace the normalized first-pass contract, while `formatPartialReviewComment()` and Review Details keep their surface-specific framing without describing different review states.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `formatReviewDetailsSummary()` timeout branch in `src/lib/review-utils.ts` | Fail the task and keep the existing branch isolated until the shared contract is restored. | N/A for pure formatter work. | Fallback to normalized first-pass wording first, then append retry metadata; never emit retry-state lines alone. |
| `formatPartialReviewComment()` in `src/lib/partial-review-formatter.ts` | Do not invent handler-specific copy; route through the shared helper contract instead. | N/A for pure formatter work. | Preserve bounded truth by omitting unsupported fields instead of inferring counts from malformed inputs. |

## Load Profile

- **Shared resources**: string-rendering helpers reused by multiple publication paths.
- **Per-operation cost**: trivial CPU/string assembly per render.
- **10x breakpoint**: correctness drift, not resource exhaustion; the main risk is duplicated or contradictory lines across surfaces.

## Negative Tests

- **Malformed inputs**: verify timeout paths with missing remaining scope or missing covered scope still render truthful bounded state.
- **Error paths**: verify retry metadata can coexist with bounded-first-pass wording without replacing it.
- **Boundary conditions**: assert cases where continuation is pending, stopped, or already merged after retry so wording changes only where state changes.

## Steps

1. Update `src/lib/review-utils.ts` so Review Details always composes normalized first-pass wording when available, even when timeout retry metadata is also present.
2. Keep timeout-specific retry-state lines additive, not substitutive, and preserve surface-specific formatting differences only at the presentation layer.
3. Extend formatter tests to prove the two renderers tell the same coverage and continuation story for timeout and max-turns cases.
4. Run the formatter tests again and tighten expectations until wording parity is explicit.

## Must-Haves

- [ ] Review Details and bounded comments share the same coverage, remaining-scope, and continuation-state story.
- [ ] Timeout retry metadata remains visible without bypassing normalized first-pass wording.

## Verification

- `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`
- Confirm there is at least one formatter assertion covering timeout retry metadata plus shared first-pass wording in the same output.

## Observability Impact

- Signals added/changed: formatter outputs for timeout and max-turns states become directly comparable across both visible surfaces.
- How a future agent inspects this: run the formatter tests and inspect the timeout-related assertions in `src/lib/review-utils.test.ts` and `src/lib/partial-review-formatter.test.ts`.
- Failure state exposed: a surface-specific drift shows up as assertion failures without needing full handler orchestration.

## Inputs

- `src/lib/review-utils.ts` — Review Details formatter with current `timeoutProgress` precedence.
- `src/lib/review-utils.test.ts` — formatter coverage for bounded first-pass and timeout progress lines.
- `src/lib/partial-review-formatter.ts` — bounded comment renderer that must remain aligned with Review Details.
- `src/lib/partial-review-formatter.test.ts` — partial-comment expectations that should mirror the same contract.
- `src/lib/review-first-pass.ts` — normalized payload semantics that define what each visible surface may claim.

## Expected Output

- `src/lib/review-utils.ts` — Review Details formatter composed from the shared visible-state contract plus additive retry metadata.
- `src/lib/review-utils.test.ts` — parity-focused tests proving timeout and max-turns wording matches the shared contract.
- `src/lib/partial-review-formatter.ts` — bounded comment renderer still aligned with the shared formatter contract.
- `src/lib/partial-review-formatter.test.ts` — updated expectations showing the same coverage and continuation story as Review Details.
