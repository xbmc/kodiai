---
estimated_steps: 3
estimated_files: 2
skills_used:
  - verification-before-completion
---

# T03: Align the runbook heading and clear the last stranded PR #87 code cleanup

**Slice:** S03 — Residual operator truthfulness cleanup
**Milestone:** M051

## Description

After the parser and verifier repairs, the remaining visible drift is a stale runbook heading and one adjacent type-shape cleanup comment left behind on PR #87. This task keeps scope tight: fix the docs heading so the operator surface names the existing `verify:m048:*` family truthfully, and replace the local `timeoutProgress` type literal in `src/handlers/review.ts` with the exported `TimeoutReviewDetailsProgress` type so the closed PR no longer leaves a trivial maintainability debt behind.

## Steps

1. Rename the `## M050 Timeout-Truth Verifier Surfaces` heading in `docs/runbooks/review-requested-debug.md` to an M048-correct heading above the already-correct `verify:m048:*` commands.
2. Update `src/handlers/review.ts` to import and use `TimeoutReviewDetailsProgress` from `src/lib/review-utils.ts` instead of restating the same shape inline.
3. Run the nearby handler/review-utils tests, targeted runbook grep, and `bun run tsc --noEmit` to prove the cleanup is mechanical and non-behavioral.

## Must-Haves

- [ ] The runbook heading above `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03` is M048-correct.
- [ ] `src/handlers/review.ts` no longer declares a local inline `timeoutProgress` object type that duplicates `TimeoutReviewDetailsProgress`.
- [ ] Nearby tests and the project typecheck still pass after the cleanup.

## Verification

- `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`
- `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md`
- `bun run tsc --noEmit`

## Inputs

- `docs/runbooks/review-requested-debug.md` — current operator runbook with the stale M050 heading above M048 commands.
- `src/handlers/review.ts` — current handler that still declares a local inline `timeoutProgress` shape.
- `src/lib/review-utils.ts` — exported home of `TimeoutReviewDetailsProgress`.

## Expected Output

- `docs/runbooks/review-requested-debug.md` — runbook heading aligned to the existing M048 verifier family.
- `src/handlers/review.ts` — handler updated to reuse `TimeoutReviewDetailsProgress` instead of duplicating the type literal.
