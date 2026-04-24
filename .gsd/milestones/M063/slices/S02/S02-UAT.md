# S02: S02 — UAT

**Milestone:** M063
**Written:** 2026-04-24T06:10:33.937Z

# UAT — M063 / S02 One evolving review surface with explicit revisions

## Preconditions
- Run in the repository root with dependencies installed.
- GitHub publication is not required; the deterministic verifier and handler tests are the acceptance surface for this slice.
- Use the shipped code from milestone M063 with `verify:m063:s02` available in `package.json`.

## Test Case 1 — Timeout first pass keeps one visible review surface
1. Run `bun test ./src/handlers/review.test.ts -t "timeout publication uses checkpoint-backed analyzed progress and retry state"`.
   - Expected: the test passes and asserts that the bounded first-pass comment is published with the base `reviewOutputKey` marker.
2. Run `bun run verify:m063:s02 -- --json`.
   - Expected: scenario `timeout-first-pass` reports `statusCode: "same-surface-pending"`, `visibleSurfaceCount: 1`, `continuationSurfaceCount: 0`, and passing `marker-continuity` / `review-details-attached` checks.
3. Inspect the JSON output for `sameSurface: true` on `timeout-first-pass`.
   - Expected: continuation ownership is anchored to one visible surface, not a second lifecycle comment.

## Test Case 2 — Continuation merge shows explicit revisions on the same surface
1. Run `bun test ./src/lib/partial-review-formatter.test.ts -t "renders explicit new still-open and resolved continuation revision wording"`.
   - Expected: the formatter test passes and proves user-visible revision text is emitted for meaningful continuation deltas.
2. Run `bun test ./src/handlers/review.test.ts -t "retry merge updates the bounded comment and Review Details with merged coverage"`.
   - Expected: the handler test passes and confirms the bounded canonical comment is updated in place rather than replaced by a sibling public comment.
3. Re-run `bun run verify:m063:s02 -- --json` and inspect `merge-revisions`.
   - Expected: `statusCode: "same-surface-revised"`, `sameSurface: true`, `revisionVisible: true`, `visibleSurfaceCount: 1`, `continuationSurfaceCount: 0`.

## Test Case 3 — No-delta continuation settles quietly
1. Run `bun test ./src/handlers/review.test.ts -t "retry merge leaves the canonical comment unchanged when continuation has no meaningful delta"`.
   - Expected: the test passes and proves no public update is emitted when continuation finds no meaningful delta.
2. Re-run `bun run verify:m063:s02 -- --json` and inspect `settle-no-delta`.
   - Expected: `statusCode: "same-surface-quiet-settlement"`, `quietNoDelta: true`, `revisionVisible: false`, `visibleSurfaceCount: 1`, `continuationSurfaceCount: 0`.
3. Confirm the verifier’s `quiet-settlement` check is `pass`.
   - Expected: the original bounded first-pass comment remains the only visible surface and no noisy follow-up publication is required.

## Test Case 4 — Duplicate lifecycle comment regressions are rejected
1. Run `bun test ./scripts/verify-m063-s02.test.ts -t "rejects duplicate public lifecycle comments when continuation publishes a second visible surface"`.
   - Expected: the test passes by detecting the regression and rejecting the scenario.
2. Run `bun test ./scripts/verify-m063-s02.test.ts -t "rejects marker continuity regressions when the canonical surface loses the base reviewOutputKey"`.
   - Expected: the test passes by failing the malformed scenario, proving the verifier guards marker continuity and same-surface ownership.

## Test Case 5 — Package-level proof and type safety stay green
1. Run `bun test ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts ./scripts/verify-m063-s02.test.ts ./scripts/verify-m063-s01.test.ts`.
   - Expected: the suite passes end-to-end for formatter, handler, and verifier surfaces.
2. Run `bun run tsc --noEmit`.
   - Expected: exit code 0.

## Edge Cases Covered
- Timeout first pass publishes partial progress but still owns the later continuation lifecycle.
- Continuation can revise earlier findings, but the revision must remain visible and legible on the canonical comment.
- Continuation with no meaningful delta must settle without editing or appending a noisy new public comment.
- Marker continuity loss or reintroduction of a second public lifecycle comment is treated as a contract failure.
