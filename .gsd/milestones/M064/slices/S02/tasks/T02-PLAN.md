---
estimated_steps: 37
estimated_files: 5
skills_used: []
---

# T02: Harden canonical-state transitions for retry enqueue, retry execution, and projection failures

Wire the real review timeout/retry path so canonical continuation-family state stays truthful when downstream projections or retry execution fail. This task advances R067 by extending supersession-safe authority writes to the live orchestration gaps, and supports R074 by degrading projection status instead of leaving ambiguity in logs.

## Steps
1. Refactor the continuation-family helper seam in `src/handlers/review.ts` just enough to express "same authoritative outcome, degraded projection status" updates and final fallback outcomes for retry enqueue failure and retry execution failure without changing public PR behavior.
2. Update the timeout scheduling path so telemetry-write failures and retry enqueue failures correct the canonical family row rather than leaving `continuation-pending` as the last durable truth. Preserve ordinal-guarded writes and keep `ReviewWorkCoordinator` as the runtime publish gate from D188.
3. Update the queued retry execution path so thrown retry work finalizes canonical state before cleanup, and stale/superseded retries cannot overwrite a newer authoritative row or leave a misleading checkpoint-durability story.
4. Add/expand `src/handlers/review.test.ts` coverage for retry enqueue failure, retry execution failure, telemetry projection degradation, and stale retry supersession under canonical-state assertions.

## Must-Haves
- [ ] Retry enqueue failure does not leave canonical state stuck at `continuation-pending`.
- [ ] Retry execution failure records a truthful final canonical outcome/stop reason before retry/base checkpoint cleanup runs.
- [ ] Telemetry projection failure degrades canonical `projectionStatus` while preserving the correct authoritative outcome.
- [ ] Stale retry attempts remain unable to overwrite newer authoritative rows or imply durable success after supersession.

## Verification
- `bun test src/handlers/review.test.ts`
- Canonical-state assertions cover enqueue failure, retry failure, telemetry degradation, and superseded stale retry scenarios.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `jobQueue.enqueue` | Finalize canonical row with truthful non-pending lifecycle state and release retry claim | Same canonical fallback path should win if enqueue never completes | N/A — local queue API |
| `executor.execute` | Persist canonical terminal/degraded state before cleanup and log the retry failure | Preserve canonical truth for timed-out retry before cleanup | N/A — typed execution result |
| `telemetryStore.recordResilienceEvent` / related projection writes | Mark canonical `projectionStatus` degraded and continue | Same degraded canonical projection status | N/A — local projection call |

## Load Profile
- **Shared resources**: review work coordinator family claims, canonical store row, checkpoint rows, telemetry writes.
- **Per-operation cost**: one canonical upsert per lifecycle transition plus best-effort projection writes; test coverage exercises one retry family at a time.
- **10x breakpoint**: duplicate retry attempts contending on the same family row; ordinal-guarded upserts must continue preventing stale writes from overtaking newer authority.

## Negative Tests
- **Malformed inputs**: Invalid/sparse checkpoint state should still avoid crashing canonical fallback paths.
- **Error paths**: queue rejection, thrown retry execution, and telemetry-write exceptions each assert the resulting canonical row.
- **Boundary conditions**: stale attempt finishing after supersession cannot change the family row away from the newer authoritative attempt.

## Inputs
- `src/handlers/review.ts` — current continuation scheduling, telemetry projection, and retry cleanup logic.
- `src/handlers/review.test.ts` — existing canonical-state success-path coverage and supersession behavior tests.
- `src/knowledge/types.ts` — current authoritative outcome, stop reason, and projection-status contracts.
- `src/knowledge/store.ts` — ordinal-guarded continuation-family upsert semantics.
- `src/jobs/review-work-coordinator.ts` — runtime publish-rights/supersession contract.

## Expected Output
- `src/handlers/review.ts` — hardened canonical transition/degradation handling for real orchestration failures.
- `src/handlers/review.test.ts` — regression coverage for enqueue failure, retry failure, projection degradation, and stale supersession.

## Inputs

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/jobs/review-work-coordinator.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``

## Verification

bun test src/handlers/review.test.ts

## Observability Impact

Adds durable failure-state visibility for retry enqueue/execution/projection failures through canonical continuation-family rows, reducing dependence on transient logs.
