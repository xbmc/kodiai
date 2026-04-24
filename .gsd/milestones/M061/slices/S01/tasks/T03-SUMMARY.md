---
id: T03
parent: S01
milestone: M061
key_files:
  - scripts/usage-report.ts
  - scripts/usage-report.test.ts
  - scripts/phase72-telemetry-follow-through.ts
  - scripts/phase72-telemetry-follow-through.test.ts
  - scripts/phase75-live-ops-verification-closure.ts
  - scripts/phase75-live-ops-verification-closure.test.ts
key_decisions:
  - Standardized operator telemetry scripts around pure report/verifier builders plus a thin `createDbClient()` CLI wrapper so tests can pin current-schema behavior without a live database.
  - Made Postgres access-state reporting (`available`/`missing`/`unavailable`) an explicit preflight surface for operator scripts instead of throwing or consulting the removed SQLite path.
duration: 
verification_result: passed
completed_at: 2026-04-24T00:50:01.872Z
blocker_discovered: false
---

# T03: Rebuilt the operator usage and verifier scripts on live Postgres telemetry with fail-open access reporting and current-schema attribution surfaces.

**Rebuilt the operator usage and verifier scripts on live Postgres telemetry with fail-open access reporting and current-schema attribution surfaces.**

## What Happened

I replaced the stale SQLite-only `scripts/usage-report.ts` CLI with a Postgres-backed reporting seam built on `createDbClient()`, then added `scripts/usage-report.test.ts` to pin the new operator contract: explicit database access preflight, truthful token/cost/cache totals, task-path attribution, delivery-level prompt accounting, and prompt-section summaries derived from `llm_cost_events`, `rate_limit_events`, and `prompt_section_events`. The rewritten script now exports pure report/query/render helpers so tests do not depend on a live database, while the CLI remains a thin live-DB wrapper that reports `available`/`missing`/`unavailable` access instead of falling back to the obsolete telemetry SQLite file.

I applied the same pattern to `scripts/phase72-telemetry-follow-through.ts` and `scripts/phase75-live-ops-verification-closure.ts`: both verifiers now read from `telemetry_events` and `rate_limit_events` through `createDbClient()`, preserve their deterministic review/mention cache-order logic, and emit fail-open preflight output when Postgres access is missing or unavailable. Their tests were updated from in-memory SQLite fixtures to current-schema pure-query fixtures so the deterministic evidence logic remains machine-checkable without importing stale `executions` assumptions.

This preserves the slice’s operator observability goal: the repaired scripts now surface live DB access state, token and cost attribution by task path, cache-effectiveness summaries, and prompt-section evidence in a form downstream slices can reuse without re-discovering schema truth. I also attempted to capture the reusable operator-script pattern in GSD memory, but the memory write failed, so that cross-session note was not persisted automatically.

## Verification

Ran the task’s required verification command, which passed all targeted script tests covering the new Postgres-backed usage report and both repaired deterministic verifiers. Then ran ESLint on all touched script files to confirm the refactor remained clean outside the narrow unit fixtures. LSP diagnostics were unavailable because no language server was running in this workspace, so test and lint results are the authoritative verification for this task.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts` | 0 | ✅ pass | 133ms |
| 2 | `bun x eslint scripts/usage-report.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.ts scripts/phase75-live-ops-verification-closure.test.ts` | 0 | ✅ pass | 445ms |

## Deviations

Added a new tracked test file at `scripts/usage-report.test.ts` because the plan expected it in the output but it did not exist locally. I also refactored the three scripts to expose pure builders/query evaluators in addition to their CLI entrypoints so the new Postgres-backed behavior could be tested deterministically without a live database; this is an implementation-level adaptation, not a scope change.

## Known Issues

`capture_thought` failed when attempting to persist the reusable operator-script pattern, so no durable memory entry was recorded from this task. LSP diagnostics were unavailable in this workspace because no TypeScript language server was running.

## Files Created/Modified

- `scripts/usage-report.ts`
- `scripts/usage-report.test.ts`
- `scripts/phase72-telemetry-follow-through.ts`
- `scripts/phase72-telemetry-follow-through.test.ts`
- `scripts/phase75-live-ops-verification-closure.ts`
- `scripts/phase75-live-ops-verification-closure.test.ts`
