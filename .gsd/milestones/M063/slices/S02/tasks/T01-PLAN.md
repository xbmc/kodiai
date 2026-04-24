---
estimated_steps: 10
estimated_files: 4
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T01: Anchor continuation to one canonical review comment

Collapse the timeout/continuation public lifecycle onto the bounded first-pass comment so later continuation passes update one stable visible surface instead of creating a second standalone Review Details comment.

Steps:
1. Audit `src/handlers/review.ts` timeout, append, and retry-merge branches to define the canonical comment contract: the bounded first-pass comment is rediscoverable by base `reviewOutputKey` and owns nested Review Details updates.
2. Update the bounded comment formatting/publication path so the canonical comment carries a stable review-output marker or equivalent durable identity, then route timeout Review Details publication through same-surface append/update behavior instead of a standalone continuation lifecycle comment.
3. Rework retry merge to refresh Review Details on that same canonical comment, still honoring `ReviewWorkCoordinator` publish-right rechecks and existing fallback behavior only where the base summary surface truly does not exist.
4. Extend handler coverage around timeout publication, same-surface refresh, and stale-authority suppression so the contract is explicit before revision wording is added.

Must-haves:
- The bounded first-pass comment is rediscoverable later from the base `reviewOutputKey` without relying only on ephemeral locals.
- Timeout/continuation paths stop creating a second public lifecycle comment when the canonical summary surface exists.
- Retry merge updates the same canonical comment in place and keeps publish-right suppression semantics intact.

## Inputs

- ``src/handlers/review.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/handlers/review.test.ts``
- ``src/handlers/review-idempotency.ts``
- ``src/lib/review-continuation-lifecycle.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/handlers/review.test.ts``

## Verification

bun test ./src/handlers/review.test.ts --filter "timeout" && bun test ./src/handlers/review.test.ts --filter "retry merge"

## Observability Impact

- Keeps comment-body marker continuity inspectable in handler tests.
- Preserves publish-right suppression evidence on the real queued retry path.
- Makes canonical comment ownership diagnosable from one comment body instead of two divergent public artifacts.
