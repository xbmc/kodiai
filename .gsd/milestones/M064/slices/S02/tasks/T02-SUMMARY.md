---
id: T02
parent: S02
milestone: M064
key_files:
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - package.json
key_decisions:
  - Used a shared continuation-family finalize helper so retry enqueue failures and retry execution exceptions resolve through the same supersession-safe canonical-state path.
  - Carried telemetry projection degradation as canonical metadata (`projectionStatus: degraded`) instead of leaving telemetry write failures visible only in logs.
  - Preserved ordinal-guarded store semantics by writing superseded outcomes with the newer authoritative attempt id rather than letting stale retry attempts overwrite authority.
duration: 
verification_result: mixed
completed_at: 2026-04-24T07:45:16.089Z
blocker_discovered: false
---

# T02: Hardened review continuation-family state so enqueue failures, retry crashes, telemetry degradation, and stale retries leave truthful canonical lifecycle records.

**Hardened review continuation-family state so enqueue failures, retry crashes, telemetry degradation, and stale retries leave truthful canonical lifecycle records.**

## What Happened

I extended the continuation-family state seam in `src/handlers/review.ts` instead of scattering new one-off writes through the timeout/retry flow. The handler now has a shared degraded-state helper plus a finalize helper that resolves a retry attempt either to its fallback terminal outcome or, when a newer attempt has already taken authority, to a superseded canonical record keyed by the newer attempt. I then wired the live failure branches through that seam: timeout telemetry failures now carry a projection-degraded signal into the eventual canonical write, retry enqueue failures rewrite the family row from `continuation-pending` to a truthful blocked/no-follow-up outcome, and retry execution exceptions finalize canonical state before checkpoint cleanup. On the test side, I expanded `src/handlers/review.test.ts` with regression coverage for retry enqueue failure, telemetry degradation on a canonical timeout row, and stale retry supersession after a thrown retry executor path, while keeping the existing merge and quiet-settlement coverage intact. This kept the public PR behavior unchanged while making the durable continuation-family row the single truthful authority for these orchestration edge cases.

## Verification

I first ran the canonical continuation-family subset to validate the new regression tests against the pre-fix behavior; the new enqueue-failure, telemetry-degradation, and stale-retry cases failed in the expected ways, confirming the gaps. After updating the handler, I reran the canonical continuation-family subset and all seven canonical-state scenarios passed. I then ran the full `src/handlers/review.test.ts` suite, which passed end-to-end with 146 passing tests. I also attempted the slice-plan verification command `bun run verify:m064:s02 -- --json`, but this workspace does not define that script in `package.json`, so that verification surface is currently unavailable. LSP diagnostics were also unavailable because no language server was running in the workspace.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/handlers/review.test.ts --test-name-pattern 'canonical continuation-family state'` | 1 | ❌ fail | 595ms |
| 2 | `bun test src/handlers/review.test.ts --test-name-pattern 'canonical continuation-family state'` | 0 | ✅ pass | 620ms |
| 3 | `bun test src/handlers/review.test.ts` | 0 | ✅ pass | 6810ms |
| 4 | `bun run verify:m064:s02 -- --json` | 1 | ❌ fail | 0ms |
| 5 | `lsp diagnostics src/handlers/review.ts` | 1 | ❌ fail | 0ms |
| 6 | `lsp diagnostics src/handlers/review.test.ts` | 1 | ❌ fail | 0ms |

## Deviations

The planned slice-level verification script `verify:m064:s02` is not present in this repository snapshot, so I could not execute that exact verification surface and instead verified with the full handler test suite plus the focused canonical regression subset.

## Known Issues

The milestone plan references `bun run verify:m064:s02 -- --json`, but `package.json` currently exposes `verify:m064:s01` only; the slice-level verification command for S02 is missing. LSP diagnostics were unavailable in-session because no language server was active.

## Files Created/Modified

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `package.json`
