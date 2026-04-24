# S02: S02 — UAT

**Milestone:** M062
**Written:** 2026-04-24T04:46:53.847Z

# UAT — S02 Coverage and visible-state rendering

## Preconditions
- Workspace is on the S02-complete code state.
- Test dependencies are installed and `bun` commands run successfully.
- Reviewer output is exercised through the formatter and handler test suites listed below.

## Test Case 1 — Timeout bounded comment states covered scope, remaining scope, and continuation truthfully
1. Run `bun test ./src/lib/partial-review-formatter.test.ts`.
2. Inspect the passing case `bounded timeout disclaimer shows normalized reason, evidence, coverage, and continuation state`.
3. Expected: the public bounded comment includes the timeout reason, checkpoint evidence source, explicit covered scope, explicit remaining scope, and continuation state wording.
4. Expected: wording is bounded and does not imply exhaustive review.

## Test Case 2 — Review Details matches the bounded comment instead of drifting
1. Run `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`.
2. Inspect the passing cases `keeps shared bounded first-pass wording visible when timeout retry metadata is present` and `Review Details and bounded comment tell the same timeout coverage and continuation story`.
3. Expected: Review Details renders the same coverage/remaining/continuation story as the public comment.
4. Expected: timeout retry metadata appears as extra lines only, without replacing the shared first-pass summary.

## Test Case 3 — Missing or malformed scope degrades truthfully
1. Run `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`.
2. Inspect the passing cases for missing covered scope, missing remaining scope, and malformed timeout scope.
3. Expected: output says scope was `not confirmed from structured evidence` (or equivalent truthful degradation) rather than inventing reviewed or remaining scope.
4. Expected: continuation wording stays explicit even when scope fields are absent.

## Test Case 4 — Retry merge refreshes both visible surfaces from merged checkpoint evidence
1. Run `bun test ./src/handlers/review.test.ts`.
2. Inspect the passing case `retry merge updates the bounded comment and Review Details with merged coverage`.
3. Expected: merged checkpoint evidence becomes the canonical first-pass coverage source for both the public comment and Review Details.
4. Expected: reviewed coverage is not double-counted after the retry completes.

## Test Case 5 — Bounded max-turns fallback still publishes coherent Review Details
1. Run `bun test ./src/handlers/review.test.ts`.
2. Inspect the passing cases `publishes bounded first-pass output for max-turns when checkpoint evidence exists` and `publishes bounded first-pass Review Details for max-turns when checkpoint evidence exists`.
3. Expected: exhausted `max_turns` no longer leaves the user with comment-only bounded prose.
4. Expected: Review Details publishes the same bounded coverage and continuation contract as other constrained branches.

## Test Case 6 — Compile gate confirms no type regressions in the unified contract wiring
1. Run `bun run tsc --noEmit`.
2. Expected: command exits 0.
3. Expected: the shared formatter wiring across `src/lib/review-utils.ts`, `src/lib/partial-review-formatter.ts`, and `src/handlers/review.ts` introduces no TypeScript regressions.

## Edge Cases Covered
- Zero-evidence timeout remains a hard-failure path rather than a bounded-success overclaim.
- Missing scope fields degrade to truthful uncertainty rather than implied exhaustiveness.
- Retry metadata can coexist with bounded first-pass wording without replacing it.
- Retry merge uses merged checkpoint totals as canonical reviewed coverage instead of additive retry math.
