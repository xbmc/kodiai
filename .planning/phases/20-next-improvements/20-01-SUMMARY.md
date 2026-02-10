---
phase: 20-next-improvements
plan: 01
subsystem: write-mode
tags: [write-mode, guardrails, observability, ci]

# Dependency graph
requires:
  - phase: 19-write-confirmation
    provides: plan-only and write-mode intents
provides:
  - Update existing PR branch when possible (same-repo head)
  - Stronger default write deny patterns and secret scanning
  - Basic CI workflow for PRs
  - Webhook ingress includes receivedAt + userAgent
affects: [mentions, write-mode, ops, ci]

# Metrics
duration: 30 min
completed: 2026-02-10
---

# Phase 20 Plan 01: Next Improvements Summary

Implemented the next set of quality improvements:

- Write-mode applies changes directly to an existing PR branch when the PR head is in the same repo; otherwise it falls back to the bot PR flow.
- Write guardrails are stronger by default (expanded deny patterns) and secret detection includes additional token patterns plus a best-effort entropy scan.
- Added CI workflow to run `bun test` on PRs (and best-effort `tsc --noEmit`).
- Webhook ingress logs capture `receivedAt` and `userAgent` to aid delivery forensics.

## Verification

- `bun test`

## Task Commits

1. `f6b349a041` feat(write): update PR branch when possible
2. `76b63a9496` feat(write-policy): expand deny defaults and secret scanning
3. `d0f10a8b5d` chore(ci): add bun test workflow
