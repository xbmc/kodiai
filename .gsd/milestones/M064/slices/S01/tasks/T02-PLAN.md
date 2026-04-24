---
estimated_steps: 1
estimated_files: 6
skills_used: []
---

# T02: Project coordinator authority transitions into canonical lifecycle state

Wire the runtime publish gate from D188 into the new canonical store so authoritative attempt changes, supersession, and terminal outcomes are persisted durably during review/continuation handling. Update the coordinator-facing orchestration in `src/handlers/review.ts` to write canonical rows for initial timeout, continuation scheduling, continuation merge, quiet settlement, and stale-attempt suppression without letting late attempts overwrite newer authority. Keep `review_checkpoints` and `resilience_events` as projection/scratch surfaces only, but record projection status in canonical state so degraded writes are explicit instead of inferred.

## Inputs

- ``src/jobs/review-work-coordinator.ts``
- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/telemetry/types.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/knowledge/types.ts``
- ``src/knowledge/store.ts``
- ``src/telemetry/types.ts``

## Verification

bun test src/handlers/review.test.ts

## Observability Impact

Canonical rows should expose authoritative attempt id, stop reason, final outcome, superseded-by linkage, and projection health so a future agent can tell whether truth is absent or only a projection failed.
