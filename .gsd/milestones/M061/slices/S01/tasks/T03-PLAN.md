---
estimated_steps: 2
estimated_files: 7
skills_used: []
---

# T03: Replace stale SQLite reporting with Postgres-backed operator surfaces

Rebuild the operator-facing usage and smoke reporting path on top of `createDbClient()` and the live Postgres telemetry tables. This task must remove the stale `executions`/SQLite assumptions from the main CLI and update the deterministic verifier fixtures/tests to the current schema while preserving fail-open preflight messaging.

Keep the reporting surface focused on truthful attribution: token totals, cost totals, cache effectiveness, task-path separation, and prompt-section summaries by delivery/task type.

## Inputs

- ``scripts/usage-report.ts``
- ``scripts/phase72-telemetry-follow-through.ts``
- ``scripts/phase72-telemetry-follow-through.test.ts``
- ``scripts/phase75-live-ops-verification-closure.ts``
- ``scripts/phase75-live-ops-verification-closure.test.ts``
- ``src/db/client.ts``
- ``src/telemetry/store.ts``
- ``src/telemetry/types.ts``

## Expected Output

- ``scripts/usage-report.ts``
- ``scripts/usage-report.test.ts``
- ``scripts/phase72-telemetry-follow-through.ts``
- ``scripts/phase72-telemetry-follow-through.test.ts``
- ``scripts/phase75-live-ops-verification-closure.ts``
- ``scripts/phase75-live-ops-verification-closure.test.ts``

## Verification

bun test scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts

## Observability Impact

Restores truthful operator inspection against the live DB, including explicit access-state output when Postgres is unavailable and machine-checkable cache/token attribution from the repaired scripts.
