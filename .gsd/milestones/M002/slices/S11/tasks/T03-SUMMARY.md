---
id: T03
parent: S11
milestone: M002
provides:
  - Write-policy refusals include rule family + file/path + detector/pattern when available
  - Same behavior for PR-branch update path (no bot-PR fallback on policy refusal)
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 20 min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# T03: 21-polish 03

**# Phase 21 Plan 03: Guardrails Refusal UX Summary**

## What Happened

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
