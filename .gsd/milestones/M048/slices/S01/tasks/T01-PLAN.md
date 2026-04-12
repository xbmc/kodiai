---
estimated_steps: 5
estimated_files: 8
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Capture live review phase timings across queue and executor

**Slice:** S01 — Live Phase Timing and Operator Evidence Surfaces
**Milestone:** M048

## Description

Build the truthful timing contract at the real runtime seams before changing the visible surfaces. The review handler already has natural boundaries; this task should expose them as one normalized phase object so later tasks can render and verify the same evidence instead of re-measuring it differently.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/jobs/queue.ts` wait metadata | Fail open to `queue wait: unavailable` while still running the review job. | N/A — queue wait is measured before execution starts. | Reject negative or missing wait values in tests; do not coerce them to `0ms`. |
| `src/execution/executor.ts` subphase capture | Preserve the existing execution result and mark `executor handoff` / `remote runtime` unavailable or degraded instead of crashing the review. | Return timeout results with the same phase contract plus explicit timeout state so operators can see where execution stopped. | Ignore malformed span payloads from the remote result and fall back to locally measured executor timings. |
| Structured completion log in `src/handlers/review.ts` | Logging failure must not block review publication. | Keep the phase object available for Review Details even when log emission is skipped. | Do not emit a partially correlated payload without both `deliveryId` and `reviewOutputKey` when those identifiers should exist. |

## Load Profile

- **Shared resources**: per-installation queue slots, the single ACA worker path, and Azure log volume for review completion events.
- **Per-operation cost**: constant-time `Date.now()` stamps plus one bounded structured completion log per review.
- **10x breakpoint**: queue backlog and Azure log noise grow before CPU does, so emit exactly one normalized phase summary instead of many per-step logs.

## Negative Tests

- **Malformed inputs**: negative wait values, missing executor timing spans, malformed remote timing payloads, or missing correlation ids.
- **Error paths**: workspace creation failure, ACA timeout/failure, and review completion with no publish event still preserve a truthful phase report.
- **Boundary conditions**: clean reviews, findings-published reviews, and timeout reviews all produce the same named phases with explicit unavailable/degraded wording when needed.

## Steps

1. Extend the job/executor contracts so the review path can carry queue wait plus executor handoff/runtime timings without guessing from ad hoc log timestamps.
2. Change `src/jobs/queue.ts` and `src/jobs/types.ts` so the enqueued review callback receives deterministic wait metadata instead of only logging it.
3. Update `src/execution/types.ts`, `src/execution/executor.ts`, and `src/execution/executor.test.ts` to return normalized executor subphases that distinguish staging/handoff from remote runtime and keep timeout/failure paths truthful.
4. In `src/handlers/review.ts`, timestamp the local review phases, merge them with queue/executor timings, and emit one structured completion log carrying `deliveryId`, `reviewOutputKey`, required phase names, statuses, and total wall-clock time.
5. Add focused regression coverage for queue wait propagation and merged review-phase output before moving on to Review Details rendering.

## Must-Haves

- [ ] Queue wait is available to the review handler as structured data, not only as an unparsed log line.
- [ ] Executor results expose `executor handoff` and `remote runtime` subphases for success, failure, and timeout paths.
- [ ] `src/handlers/review.ts` emits one normalized phase-timing payload keyed by `deliveryId` and `reviewOutputKey` without leaking workspace paths or secrets.

## Verification

- `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: one structured review completion log carrying queue wait, workspace preparation, retrieval/context, executor handoff, remote runtime, publication, and total duration.
- How a future agent inspects this: run the focused queue/executor/review tests and query Azure rows by `reviewOutputKey` once a live review has executed.
- Failure state exposed: unavailable/degraded phase names plus correlation-id mismatches remain visible instead of collapsing to zero durations.

## Inputs

- `src/jobs/types.ts` — queue callback contract that must carry wait metadata.
- `src/jobs/queue.ts` — current source of queue wait timing.
- `src/execution/types.ts` — executor result contract that needs new timing fields.
- `src/execution/executor.ts` — ACA staging/runtime boundary implementation.
- `src/execution/executor.test.ts` — focused executor timing regression coverage.
- `src/handlers/review.ts` — review orchestration phases and final structured log emission.
- `src/handlers/review.test.ts` — end-to-end review handler contract tests.

## Expected Output

- `src/jobs/types.ts` — queue callback contract exposes deterministic wait metadata.
- `src/jobs/queue.ts` — enqueued jobs pass structured wait timing to review execution.
- `src/jobs/queue.test.ts` — queue wait propagation is covered with real assertions.
- `src/execution/types.ts` — executor result type includes normalized timing subphases.
- `src/execution/executor.ts` — executor returns truthful handoff/runtime timings on success, failure, and timeout paths.
- `src/execution/executor.test.ts` — executor timing contract is locked with focused tests.
- `src/handlers/review.ts` — local review phases merge with queue/executor timings and emit one structured completion log.
- `src/handlers/review.test.ts` — merged phase payload is covered on representative review paths.
