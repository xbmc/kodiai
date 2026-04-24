---
estimated_steps: 2
estimated_files: 5
skills_used: []
---

# T04: Publish the baseline proof and operator runbook updates

Finish the slice by documenting and verifying the repaired reporting path. Update smoke/runbook docs to the new Postgres-backed commands, add a dedicated baseline proof command if the existing scripts are not sufficient, and ensure the slice-level verification exercises mention/review/slack path attribution plus prompt-section visibility.

This task closes the integration loop so downstream slices can consume a stable baseline evidence surface instead of reverse-engineering scripts or schema changes.

## Inputs

- ``docs/smoke/phase72-telemetry-follow-through.md``
- ``docs/smoke/phase75-live-ops-verification-closure.md``
- ``docs/runbooks/review-requested-debug.md``
- ``package.json``
- ``scripts/usage-report.ts``
- ``scripts/phase72-telemetry-follow-through.ts``
- ``scripts/phase75-live-ops-verification-closure.ts``

## Expected Output

- ``docs/smoke/phase72-telemetry-follow-through.md``
- ``docs/smoke/phase75-live-ops-verification-closure.md``
- ``docs/runbooks/review-requested-debug.md``
- ``package.json``
- ``scripts/verify-m061-s01.ts``

## Verification

bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts && bun run lint

## Observability Impact

Documents the final inspection commands and proof surfaces so future agents/operators can reproduce baseline token-accounting evidence and distinguish access failures from missing telemetry.
