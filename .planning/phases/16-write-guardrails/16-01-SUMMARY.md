---
phase: 16-write-guardrails
plan: 01
subsystem: write-mode
tags: [write-mode, guardrails, secrets, policy, rate-limit]

# Dependency graph
requires:
  - phase: 15-write-pipeline
    provides: Mention-driven PR pipeline
provides:
  - Configurable write policy (allow/deny paths, secret scan, rate limit)
  - Enforcement before commit/push with clear user refusals
affects: [mentions, workspace, config, ops]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Enforce guardrails in trusted code before commit/push"
    - "Deny wins over allow; allowPaths optional"
    - "Best-effort secret scan against staged diff"
    - "In-memory write request rate limiter keyed by installation+repo"

key-files:
  created: []
  modified:
    - src/execution/config.ts
    - src/jobs/workspace.ts
    - src/handlers/mention.ts
    - docs/runbooks/mentions.md

key-decisions:
  - "Keep path pattern matching simple and deterministic (dir/, *.ext, exact)"
  - "Refuse policy violations with a concise reply (not a generic error)"

# Metrics
duration: 25 min
completed: 2026-02-10
---

# Phase 16 Plan 01: Write Guardrails Summary

**Added safety guardrails for mention-driven writes: path allow/deny policy, secret scan blocks, and basic rate limiting.**

## Verification

- `bun test`

## Task Commits

1. `c25ca1d4d2` feat(config): add write policy settings (paths, secrets, rate)
2. `f760981d91` feat(write): enforce path policy, secret scan, and rate limiting
