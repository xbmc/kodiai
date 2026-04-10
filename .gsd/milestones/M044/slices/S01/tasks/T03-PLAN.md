---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T03: Correlate sampled PRs to current internal publication evidence and provisional verdicts

Add lane-aware evidence correlation helpers that combine the sampled GitHub artifact with currently available internal proof. For the automatic lane, inspect durable DB-backed review/finding/checkpoint/telemetry evidence as needed. For the explicit lane, preserve source availability explicitly and return `indeterminate` when log-backed publish truth is missing instead of guessing. Cover clean-valid, findings-published, suspicious, publish-failure-shaped, and indeterminate classifications at the helper level.

## Inputs

- `src/db/migrations/001-initial-schema.sql`
- `src/telemetry/types.ts`
- `src/knowledge/store.ts`
- `docs/runbooks/review-requested-debug.md`

## Expected Output

- `src/review-audit/evidence-correlation.ts`
- `src/review-audit/evidence-correlation.test.ts`

## Verification

bun test ./src/review-audit/evidence-correlation.test.ts

## Observability Impact

Adds explicit per-source availability, evidence rationale, and provisional verdict reasons so a future agent can see whether a case is suspicious because of contradictory evidence or merely indeterminate because a source is unavailable.
