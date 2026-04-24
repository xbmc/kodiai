---
estimated_steps: 30
estimated_files: 4
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T01: Lock continuation prompt narrowing against the production prompt builder

Establish the deterministic prompt-shaping seam for S03 by comparing initial large-PR and continuation prompt assembly through `buildReviewPromptDetails(...)` and the real handler context contract. Start from `src/handlers/review.ts` and `src/execution/review-prompt.ts`, extract only the minimum shared fixture/helper surface needed to build a first-pass context and a retry context from the same review state, and add focused prompt-builder tests that assert the sections which are supposed to shrink actually do shrink. Document in the tests that narrowing is section-specific rather than universally smaller because retrieval/knowledge context is intentionally reused.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `buildReviewPromptDetails(...)` section metrics | Fail the test and verifier immediately with a section-specific assertion so prompt drift is visible at the production seam. | N/A for pure tests; keep the helper synchronous and deterministic. | Treat missing/renamed sections as contract failure and report which required section disappeared. |
| Retry-scope / handler context assumptions | Keep assertions on subset/narrowing semantics instead of exact ratio math so heuristic changes fail only when the boundedness contract breaks. | N/A for pure fixtures. | Reject fixtures that do not model a real continuation subset or large-PR first-pass shape. |

## Load Profile

- **Shared resources**: None at runtime; this task is pure prompt-construction and test execution.
- **Per-operation cost**: Two prompt builds plus section-metric comparisons per scenario.
- **10x breakpoint**: Test output becomes noisy before compute cost matters; keep the scenario matrix small and deterministic.

## Negative Tests

- **Malformed inputs**: missing retry section records, empty continuation file set, or absent large-PR first-pass context should fail the contract test.
- **Error paths**: section rename/removal or a retry prompt that grows instead of narrowing should produce explicit failure messages.
- **Boundary conditions**: verify continuation keeps required sections even when size/change sections shrink and when reused knowledge sections stay equal.

## Steps

1. Audit the initial and retry prompt-build contexts in `src/handlers/review.ts` and identify the concrete inputs that differ (`changedFiles`, `largePRContext`, continuation instructions, boundedness inputs, and retry scope metadata).
2. Add or extract the smallest tracked helper/fixture surface needed to build first-pass and continuation prompt contexts from one review scenario without duplicating handler business logic.
3. Extend `src/execution/review-prompt.test.ts` with deterministic assertions for section presence, total/section token or char deltas, subset-of-files behavior, and truthful sufficient-but-bounded wording.
4. Keep assertions resilient to reused retrieval/knowledge context by requiring narrowing where the contract actually changes instead of demanding every section shrink.

## Must-Haves

- [ ] Prompt-builder coverage proves continuation narrows `review-change-context` and `review-size-context` relative to a large-PR first pass.
- [ ] Tests prove continuation omits first-pass-only `largePRContext` expansion while preserving the required named prompt sections.
- [ ] The prompt proof surface is production-seam-based and deterministic, not a mocked prompt string snapshot.

## Verification

- `bun test src/execution/review-prompt.test.ts --filter "continuation"`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: prompt-section comparison failures become explicit test assertions on named sections and narrowing reasons.
- How a future agent inspects this: run `bun test src/execution/review-prompt.test.ts --filter "continuation"` and inspect the failing section names.
- Failure state exposed: missing section, widened retry scope, or lost boundedness wording is surfaced directly in deterministic test output.

## Inputs

- ``src/handlers/review.ts``
- ``src/execution/review-prompt.ts``
- ``src/execution/review-prompt.test.ts``
- ``src/lib/retry-scope-reducer.ts``
- ``src/lib/review-continuation-lifecycle.ts``

## Expected Output

- ``src/execution/review-prompt.test.ts``
- ``src/execution/review-prompt.ts``

## Verification

bun test src/execution/review-prompt.test.ts --filter "continuation" && bun run tsc --noEmit

## Observability Impact

Adds explicit section-level narrowing failures so continuation prompt drift is diagnosable without live executor telemetry.
