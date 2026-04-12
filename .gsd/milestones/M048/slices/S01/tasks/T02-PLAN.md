---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Render the captured timings on GitHub Review Details

**Slice:** S01 — Live Phase Timing and Operator Evidence Surfaces
**Milestone:** M048

## Description

Expose the new phase object on the surface operators already inspect first. This task should keep the required six phases readable on both the clean-review and findings-published paths and make degraded or unavailable phases explicit instead of inventing a smooth success story.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/lib/review-utils.ts` formatter | Keep Review Details publication alive by omitting the timing section only when formatting fails completely; do not break the whole comment. | N/A — pure formatting logic. | Reject malformed phase arrays in tests and render explicit unavailable wording instead of throwing in production. |
| Review Details publication path in `src/handlers/review.ts` | Fall back to the existing standalone/append publication behavior if timing-aware formatting regresses. | Timeout reviews still need Review Details timing disclosure when they publish a partial surface. | Do not silently reorder or rename required phases when one entry is missing. |

## Load Profile

- **Shared resources**: GitHub comment body size budget and existing Review Details publication/update flow.
- **Per-operation cost**: one small bounded timing block appended to the existing Review Details comment.
- **10x breakpoint**: comment readability degrades before runtime cost does, so keep ordering fixed and wording terse.

## Negative Tests

- **Malformed inputs**: missing required phase names, non-numeric durations, and malformed status values.
- **Error paths**: append fallback path, standalone Review Details path, and timeout/partial publication path all keep the timing section honest.
- **Boundary conditions**: clean reviews, findings-published reviews, and unavailable publication phases all render the same required headings and phase order.

## Steps

1. Extend `src/lib/review-utils.ts` with a stable phase-timing formatter for `queue wait`, `workspace preparation`, `retrieval/context assembly`, `executor handoff`, `remote runtime`, and `publication` plus total wall-clock time.
2. Thread the merged phase object through `formatReviewDetailsSummary(...)` and the Review Details publication code in `src/handlers/review.ts`.
3. Add focused formatter and handler tests that pin required phase order, unavailable/degraded wording, and both append-to-summary and standalone Review Details publication paths.
4. Keep the final Review Details output compact enough to remain readable beside the existing profile/findings/structural-impact sections.

## Must-Haves

- [ ] Review Details includes the required six operator phases and total wall-clock time.
- [ ] Clean and findings-published review paths both surface the same timing contract.
- [ ] Missing or degraded timings render explicit unavailable/degraded wording instead of zeroes or silent omission.

## Verification

- `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: Review Details gains a stable live timing block with required phase names and explicit degraded/unavailable wording.
- How a future agent inspects this: inspect the Review Details comment on the PR or rerun the focused formatter/handler tests.
- Failure state exposed: formatting drift, missing phases, and publication fallback behavior all become test-visible and operator-visible.

## Inputs

- `src/lib/review-utils.ts` — existing Review Details formatter entrypoint.
- `src/lib/review-utils.test.ts` — formatter regression coverage.
- `src/handlers/review.ts` — Review Details publication path that must receive the merged phase object.
- `src/handlers/review.test.ts` — publication-path tests for clean, findings, and fallback flows.

## Expected Output

- `src/lib/review-utils.ts` — stable Review Details timing formatter for the six required phases.
- `src/lib/review-utils.test.ts` — formatter tests for phase order and unavailable/degraded wording.
- `src/handlers/review.ts` — Review Details publication threads the merged phase object through both publication paths.
- `src/handlers/review.test.ts` — Review Details timing output is covered on standalone and append flows.
