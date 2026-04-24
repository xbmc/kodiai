# S01: S01 — UAT

**Milestone:** M063
**Written:** 2026-04-24T05:39:28.901Z

# UAT — M063/S01 Automatic continuation lifecycle contract

## Preconditions
- Install dependencies and run from the repository root.
- Use the committed S01 code with `src/lib/review-continuation-lifecycle.ts`, `src/handlers/review.ts`, and `scripts/verify-m063-s01.ts` present.
- No external services are required; all checks are deterministic and in-process.

## Test Case 1 — Planner automatically schedules continuation from bounded first-pass evidence
1. Run `bun test src/lib/review-continuation-lifecycle.test.ts`.
2. Confirm the test `plans a single continuation from bounded first-pass evidence and preserves base lifecycle identity` passes.
3. Expected outcome: the planner returns `decision: "schedule-continuation"`, keeps the base `reviewOutputKey`, derives `continuationReviewOutputKey` with `-retry-1`, and produces a non-empty continuation file list.

## Test Case 2 — Real handler path auto-enqueues continuation without a manual follow-up command
1. Run `bun test src/handlers/review.test.ts --filter "continuation"`.
2. Inspect the continuation-focused handler scenarios in the output.
3. Expected outcome: the handler continuation tests pass, proving a bounded first pass can queue continuation through the real review job path rather than a manual trigger or fake shortcut.

## Test Case 3 — Merge-ready continuation updates remain explicit and handler-owned
1. Run `bun run scripts/verify-m063-s01.ts --json`.
2. Find the `merge-continuation` scenario in the JSON report.
3. Expected outcome: the scenario reports `statusCode: "continuation-merged"`, `continuationStatus: "scheduled"`, `settlementStatus: "merge-ready"`, and `authorityStatus: "authoritative"`.

## Test Case 4 — No-delta continuation settles cleanly without pretending to add results
1. Run `bun run scripts/verify-m063-s01.ts --json`.
2. Find the `settle-no-delta` scenario.
3. Expected outcome: the scenario reports `statusCode: "continuation-settled-no-delta"` and `settlementStatus: "no-delta"`, proving the lifecycle explicitly settles when continuation yields no new structured results.

## Test Case 5 — No remaining scope suppresses unnecessary follow-up
1. Run `bun run scripts/verify-m063-s01.ts --json`.
2. Find the `no-follow-up` scenario.
3. Expected outcome: the scenario reports `statusCode: "continuation-not-needed"`, `continuationStatus: "not-needed"`, and no continuation review output key.

## Test Case 6 — Stale continuation loses authority before mutating visible state
1. Run `bun run scripts/verify-m063-s01.ts --json`.
2. Find the `stale-authority-suppressed` scenario.
3. Expected outcome: the scenario reports `statusCode: "continuation-authority-suppressed"` with `authorityStatus: "suppressed"`, proving newer review work can block stale queued continuation from publishing.

## Edge Cases
- Zero-evidence first pass must never schedule continuation.
- Inline-output-already-published must suppress continuation planning.
- Malformed checkpoint scope must classify as invalid for follow-up instead of inventing remaining work.
- Empty continuation scope while remaining work is claimed must fail deterministically rather than enqueue a broken retry.
