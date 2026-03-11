---
id: T01
parent: S11
milestone: M002
provides:
  - CI typecheck is required (no continue-on-error)
  - Minimal rereview mention commands (`@kodiai review` / `@kodiai recheck`)
  - Guardrail refusals include a stable reason code
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 15 min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# T01: 21-polish 01

**# Phase 21 Plan 01: Polish Summary**

## What Happened

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
