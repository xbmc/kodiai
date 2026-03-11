---
id: S11
parent: M002
milestone: M002
provides:
  - Documented end-to-end smoke procedure for xbmc/xbmc write-mode
  - Runbook snippet for grepping evidence bundle logs by deliveryId
  - Write-policy refusals include rule family + file/path + detector/pattern when available
  - Same behavior for PR-branch update path (no bot-PR fallback on policy refusal)
  - CI typecheck is required (no continue-on-error)
  - Minimal rereview mention commands (`@kodiai review` / `@kodiai recheck`)
  - Guardrail refusals include a stable reason code
  - Default execution timeout increased to reduce large-repo timeouts
  - Timeout error guidance explicitly points to `timeoutSeconds`
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 5 min
verification_result: passed
completed_at: 2026-02-11
blocker_discovered: false
---
# S11: Polish

**# Phase 21 Plan 02: xbmc/xbmc Write-Flow Smoke Test Summary**

## What Happened

# Phase 21 Plan 02: xbmc/xbmc Write-Flow Smoke Test Summary

Prepared a concrete, real-world smoke test procedure for xbmc/kodiai (default) covering the full write flow, plus a runbook snippet showing how to locate evidence bundle logs by `deliveryId`.

## What Changed

- Added an end-to-end smoke test checklist and expected outcomes:
  - `docs/smoke/xbmc-kodiai-write-flow.md`
- Added a short section to the mentions runbook on grepping evidence bundle logs by `deliveryId`:
  - `docs/runbooks/mentions.md`

## Manual Verification (Pending)

Run the steps in `docs/smoke/xbmc-kodiai-write-flow.md` and record:

- Same-repo PR: `outcome=updated-pr-branch`
- Fork PR: `outcome=created-pr` (or `reused-pr` on rerun)
- Guardrails: refusal includes rule + file/path + detector when applicable
- Logs: evidence bundle line is easy to locate by `deliveryId`

# Phase 21 Plan 03: Guardrails Refusal UX Summary

Improved write-mode refusal UX to make it obvious what triggered a block and what the smallest safe config adjustment is (when applicable).

## What Changed

- Write-policy errors now carry structured context (best-effort):
  - rule family (`denyPaths` / `allowPaths` / `secretScan`)
  - file/path
  - matched pattern (for glob rules)
  - detector (for secretScan)
- Mention handler formats refusals to include:
  - `Reason` (stable code)
  - `Rule`
  - `File`
  - `Matched pattern` / `Detector` when present
  - Smallest allowPaths snippet when blocked by allowlist
  - Conservative guidance for denyPaths + secretScan blocks

Files changed:

- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`

## Verification

- `bun test`
- `bunx tsc --noEmit`

# Phase 21 Plan 01: Polish Summary

Focused polish pass to make CI stricter and make rereview interactions less chatty.

- CI now requires `bunx tsc --noEmit` (typecheck is no longer best-effort).
- Mention handler supports a minimal rereview command (`@kodiai review` / `@kodiai recheck`) intended to trigger the same review output without extra commentary.
- When write-mode is blocked by policy (allow/deny paths, secret scan, rate limiting), refusals include a stable reason code to make troubleshooting and runbooks easier.

## Verification

- `bunx tsc --noEmit`
- `bun test`

## Task Commits

1. `f563ef8ded` docs(21-polish-01): add plan and advance state
2. `5fb5374d51` chore(ci): make typecheck required
3. `0c67171594` feat(mention): add minimal rereview command

# Phase 21 Plan 04: Timeout Defaults Summary

Adjusted defaults to reduce real-world timeouts on large repos.

## What Changed

- Increased default `timeoutSeconds` from 300 to 600.
- Timeout error suggestion now points explicitly to `timeoutSeconds` in `.kodiai.yml`.

Files changed:

- `src/execution/config.ts`
- `src/execution/executor.ts`
- `src/lib/errors.ts`

## Verification

- `bun test`
- `bunx tsc --noEmit`
