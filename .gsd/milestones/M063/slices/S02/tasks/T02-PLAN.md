---
estimated_steps: 6
estimated_files: 6
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T02: Render explicit continuation revisions without noisy no-delta churn

Use the existing delta-classifier seam to make continuation-visible revisions legible on the canonical comment while keeping no-meaningful-delta continuation quiet.

Steps:
1. Add a small formatter seam for continuation revision summaries sourced from `DeltaClassification`, covering new findings, still-open findings, and resolved/revised findings in user-visible wording appropriate for the bounded comment or nested Review Details block.
2. Thread delta classification through the continuation merge path in `src/handlers/review.ts` so merged updates render explicit revisions on the canonical surface instead of silently rewriting the summary draft.
3. Ensure no-delta settlement keeps the original bounded comment unchanged publicly while preserving internal settlement/logging semantics from S01.
4. Extend formatter and handler tests to prove revision wording, same-surface rendering, and quiet no-delta behavior.

## Inputs

- ``src/handlers/review.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/lib/review-utils.ts``
- ``src/lib/delta-classifier.ts``
- ``src/lib/partial-review-formatter.test.ts``
- ``src/handlers/review.test.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/lib/review-utils.ts``
- ``src/lib/partial-review-formatter.test.ts``
- ``src/handlers/review.test.ts``

## Verification

bun test ./src/lib/partial-review-formatter.test.ts && bun test ./src/handlers/review.test.ts --filter "continuation"

## Observability Impact

- Revision counts and labels become visible in comment bodies, not only logger fields.
- Handler tests should show that no-delta continuation leaves the canonical surface unchanged while merge paths expose explicit revision state.
- Future agents can inspect one comment surface to distinguish new, still-open, and resolved findings.
