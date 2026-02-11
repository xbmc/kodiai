---
phase: 21-polish
plan: 01
subsystem: mentions
tags: [ci, mentions, rereview, polish]

# Dependency graph
requires:
  - phase: 20-next-improvements
    provides: write-mode UX/guardrails and CI baseline
provides:
  - CI typecheck is required (no continue-on-error)
  - Minimal rereview mention commands (`@kodiai review` / `@kodiai recheck`)
  - Guardrail refusals include a stable reason code
affects: [ci, mentions]

# Metrics
duration: 15 min
completed: 2026-02-10
---

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
