---
phase: 21-polish
plan: 04
subsystem: execution
tags: [timeout, reliability]

# Dependency graph
requires:
  - phase: 21-polish
    provides: baseline polish changes
provides:
  - Default execution timeout increased to reduce large-repo timeouts
  - Timeout error guidance explicitly points to `timeoutSeconds`
affects: [mentions, review]

# Metrics
duration: 5 min
completed: 2026-02-11
---

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
