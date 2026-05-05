---
estimated_steps: 5
estimated_files: 5
skills_used:
  - test-driven-development
  - tdd
  - verify-before-complete
---

# T02: Implement no-op and idempotency skip publication gates

Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R081 requires a publisher that can be safely retried without duplicate batched reviews, and S04 needs truthful no-op behavior when S2 produced no safe suggestions.

Steps:
1. Add RED tests in `src/execution/formatter-suggestion-publisher.test.ts` proving an empty `suggestions` array returns `status: "no-suggestions"`, `posted: 0`, carries any provided S02 `skipped` diagnostics/counts, and never calls `createReview` or the publication gate.
2. Add RED tests with a fake `ReviewOutputPublicationGate` resolving `shouldPublish: false`, `publicationState: "skip-existing-output"`, `existingLocation: "review"`, and `idempotencyDecision: "skip-existing-review"`; assert the publisher returns `status: "skipped"`, exposes the idempotency fields, and never calls `createReview`.
3. Implement publication-gate resolution only when both `reviewOutputKey` and at least one suggestion are present. If no gate is injected, create one with `createReviewOutputPublicationGate({ owner, repo, prNumber, reviewOutputKey })`.
4. Ensure the posted result also includes idempotency status when the gate allows publication, so S04 can distinguish first publish from duplicate skip.
5. Run `bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` until the no-op/idempotency tests and T01 tests pass.

Must-haves:
- Empty suggestion batches must not create empty GitHub reviews.
- Duplicate review output keys must skip before body sanitization or GitHub writes.
- The result shape must preserve S02 skipped hunks and S03 skip/idempotency reasons separately enough for S04 partial-failure reporting.

Failure Modes (Q5): dependency `publicationGate.resolve()` rejects => return `failed` with `posted: 0` and bounded error message rather than publishing blindly; dependency returns malformed status is TypeScript-guarded by `ReviewOutputPublicationStatus`; no `reviewOutputKey` means idempotency is not applied.

Load Profile (Q6): shared resource is the idempotency scan over GitHub comments/reviews when no fake gate is injected; per-operation cost is the existing paged scan plus one createReview call; 10x breakpoint is GitHub API quota, so callers should reuse keys and this module should call the gate at most once.

Negative Tests (Q7): empty suggestions, duplicate marker in existing review, gate rejection/throwing path if included, and S02 skipped diagnostics preserved on no-op.

## Inputs

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`
- `src/execution/mcp/review-output-publication-gate.ts`
- `src/handlers/review-idempotency.ts`

## Expected Output

- `src/execution/formatter-suggestion-publisher.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`

## Verification

bun test ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

## Observability Impact

Adds skip/no-op diagnostics: idempotency decision/location/scan status, posted count zero for no-op/skip, and preserved S02 skip summaries for downstream reporting.
