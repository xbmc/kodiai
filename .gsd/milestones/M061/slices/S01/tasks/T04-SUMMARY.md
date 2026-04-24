---
id: T04
parent: S01
milestone: M061
key_files:
  - scripts/verify-m061-s01.ts
  - scripts/verify-m061-s01.test.ts
  - package.json
  - docs/smoke/phase72-telemetry-follow-through.md
  - docs/smoke/phase75-live-ops-verification-closure.md
  - docs/runbooks/review-requested-debug.md
key_decisions:
  - Implemented the slice-level proof surface by composing `queryUsageReport()`/`renderUsageReportText()` instead of duplicating SQL so the new verifier stays aligned with the repaired operator report path.
  - Kept the baseline proof focused on task-path attribution, prompt-section visibility, delivery attribution, and cache evidence, while leaving identity-specific Phase 72/75 assertions in their existing dedicated verifiers.
duration: 
verification_result: passed
completed_at: 2026-04-24T00:56:05.013Z
blocker_discovered: false
---

# T04: Added an M061/S01 baseline telemetry proof CLI and updated operator smoke/runbook docs to the Postgres-backed verification flow.

**Added an M061/S01 baseline telemetry proof CLI and updated operator smoke/runbook docs to the Postgres-backed verification flow.**

## What Happened

I added `scripts/verify-m061-s01.ts` as a dedicated slice-level baseline verifier that reuses the repaired Postgres-backed usage-report query layer, fails open on missing/unavailable database access, and checks for operator-visible attribution across `review.full`, `mention.response`, and `slack.response` plus named prompt-section visibility for mention/review flows, delivery-level breakdown rows, and cache evidence. I added `scripts/verify-m061-s01.test.ts` to lock the CLI contract, pass/fail behavior, and fail-open preflight output. I then wired the command into `package.json` as `verify:m061:s01` and updated `docs/smoke/phase72-telemetry-follow-through.md`, `docs/smoke/phase75-live-ops-verification-closure.md`, and `docs/runbooks/review-requested-debug.md` so operators run the new baseline proof before identity-specific Phase 72/75 checks and so the docs consistently describe the live `telemetry_events`/Postgres-backed surfaces instead of the removed SQLite-era paths.

## Verification

Ran the new verifier test directly, then ran the slice’s required verification command from the task plan: `bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts && bun run lint`. The new verifier test passed (4/4), and the slice verification suite passed with 279 passing tests, 17 existing skips in `src/telemetry/store.test.ts`, and a clean ESLint run.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/verify-m061-s01.test.ts` | 0 | ✅ pass | 5800ms |
| 2 | `bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts && bun run lint` | 0 | ✅ pass | 6700ms |

## Deviations

None.

## Known Issues

`capture_thought` failed twice while attempting to persist a reusable pattern memory, so no cross-session memory entry was recorded from this task. LSP diagnostics were unavailable for the new script files because no language server was running, but the verification gate passed via Bun tests and ESLint.

## Files Created/Modified

- `scripts/verify-m061-s01.ts`
- `scripts/verify-m061-s01.test.ts`
- `package.json`
- `docs/smoke/phase72-telemetry-follow-through.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `docs/runbooks/review-requested-debug.md`
