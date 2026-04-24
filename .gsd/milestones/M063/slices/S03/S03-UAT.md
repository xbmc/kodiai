# S03: S03 — UAT

**Milestone:** M063
**Written:** 2026-04-24T06:40:24.780Z

# UAT — S03 bounded continuation shaping and authority-safe proof

## Preconditions
- Repository is at the S03-complete state for milestone M063.
- Bun dependencies are installed.
- Commands are run from the repository root.

## Test Case 1 — Continuation prompt is narrower than the first pass
1. Run `bun test src/execution/review-prompt.test.ts --filter "continuation"`.
2. Confirm the suite passes.
3. Inspect the passing test names.

**Expected results**
- The continuation contract tests pass.
- Output includes assertions that continuation narrows production change/size sections while preserving required sections.
- Output includes the contract case that reused knowledge context remains present while retry instructions switch to reduced scope.

## Test Case 2 — Deterministic verifier reports bounded-but-sufficient continuation truthfully
1. Run `bun run verify:m063:s03 -- --json`.
2. Inspect the JSON response for `success`, `status_code`, and per-scenario checks.
3. Verify both `large-pr-continuation` and `quiet-no-delta-bounded` scenarios are present.

**Expected results**
- Top-level result is `success: true` with `status_code: "m063_s03_ok"`.
- Each scenario reports `boundedButSufficient: true` and `truthfulBoundedness: true`.
- `narrowingSections` includes `review-change-context` and `review-size-context`.
- `omittedFirstPassOnlySections` includes `review-size-context`.
- No scenario claims exhaustive full-PR coverage; the summary wording stays explicitly sufficient-but-bounded.

## Test Case 3 — Same-surface retry paths remain authority-safe
1. Run `bun test src/handlers/review.test.ts --filter "retry"`.
2. Confirm the retry-path suite passes.
3. Inspect the passing scenario names related to stale publication and no-delta settlement.

**Expected results**
- The suite passes.
- Output includes scenarios proving a stale/superseded retry cannot update the canonical summary body.
- Output includes scenarios proving Review Details refresh is suppressed if publish rights are lost after the canonical summary merge.
- Output includes a scenario proving retry no-delta settlement stays a public no-op on the canonical comment.

## Test Case 4 — S02 visible-surface behavior still holds after S03 proof additions
1. Run `bun run verify:m063:s02 -- --json`.
2. Inspect the returned scenario matrix.

**Expected results**
- Result is `success: true` with `status_code: "m063_s02_ok"`.
- `merge-revisions` still reports same-surface ownership and visible revisions.
- `settle-no-delta` still reports quiet same-surface settlement with no public churn.

## Test Case 5 — TypeScript gate remains clean
1. Run `bun run tsc --noEmit`.

**Expected results**
- Command exits successfully with exit code 0.
- No new type errors are introduced by the verifier or handler-path proof additions.

## Edge Cases Covered
- Continuation may omit first-pass-only `review-size-context`; omission counts as successful narrowing, not drift.
- Reused `review-knowledge-context` may stay equal-sized because retrieval context is intentionally reused.
- Quiet no-delta continuation must remain bounded and truthful without creating new public comment churn.
- Stale authority must be enforced independently on canonical summary merge and nested Review Details refresh, not just once at the start of the retry flow.
