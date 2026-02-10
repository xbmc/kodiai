---
phase: 14-write-mode-foundations
plan: 01
subsystem: mentions
tags: [write-mode, config, mentions, guardrails, ops]

# Dependency graph
requires:
  - phase: 13-xbmc-cutover
    provides: Stable GitHub App + mention UX parity + ops runbooks
provides:
  - Deny-by-default write-mode config scaffold
  - Explicit mention write-intent detection + gating
  - Operator runbook guidance for write-intent skips
affects: [mentions, config, ops]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit intent keyword for writes (apply/change)"
    - "Deny-by-default write-mode; refuse with actionable enable snippet"
    - "deliveryId-correlated mention jobs via JobQueue context"

key-files:
  created: []
  modified:
    - src/execution/config.ts
    - src/handlers/mention.ts
    - docs/runbooks/mentions.md

key-decisions:
  - "Introduce write intent as a strict prefix (apply:/change:) to avoid ambiguous writes"
  - "When write intent is detected but disabled, reply immediately without invoking the executor"

# Metrics
duration: 15 min
completed: 2026-02-10
---

# Phase 14 Plan 01: Write-Mode Foundations Summary

**Added a write-mode configuration scaffold and an explicit, gated mention write-intent path, while keeping writes deny-by-default and preserving existing review/Q&A behavior.**

## Accomplishments

- Added `write.enabled` to `.kodiai.yml` config (default: `false`).
- Added explicit write-intent detection for mentions using a low-ambiguity prefix:
  - `apply: ...`
  - `change: ...`
- When write intent is detected and write mode is disabled, Kodiai refuses and replies with a concise enable snippet.
- Added delivery-correlated job context for mention executions (`deliveryId`, `eventName`, `action`, `jobType`, `prNumber`).
- Updated mentions runbook with write-intent gating triage.

## Verification

- `bun test`

## Task Commits

1. `f5a34eff06` feat(config): add write-mode scaffold (deny-by-default)
2. `82cd57d391` feat(mention): detect write intent and gate on config
3. `6a4ac1ab95` docs(runbook): document mention write-intent gating

## Files Changed

- `src/execution/config.ts` - Add `write.enabled` (deny-by-default).
- `src/execution/config.test.ts` - Config coverage for write-mode defaults and strictness.
- `src/handlers/mention.ts` - Parse write intent prefixes; refuse when disabled; add deliveryId/job context.
- `src/handlers/mention.test.ts` - New tests for write-intent gating.
- `docs/runbooks/mentions.md` - Document write-intent triage and enable snippet.

---
*Phase: 14-write-mode-foundations*
*Completed: 2026-02-10*
