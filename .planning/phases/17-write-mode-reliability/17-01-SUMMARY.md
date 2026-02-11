---
phase: 17-write-mode-reliability
plan: 01
subsystem: write-mode
tags: [write-mode, idempotency, locking, reliability]

# Dependency graph
requires:
  - phase: 16-write-guardrails
    provides: write policy enforcement and guardrails
provides:
  - Idempotent write-mode keyed by trigger comment
  - Existing PR discovery to avoid duplicate work on retries/redeliveries
  - Best-effort in-process lock for duplicate concurrent handling
affects: [mentions, write-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write idempotency identity derived from (installation, repo, prNumber, commentId, keyword)"
    - "Deterministic head branch name derived from a short hash"
    - "Reuse existing PR by head branch discovery"

key-files:
  created: []
  modified:
    - src/handlers/mention.ts
    - src/handlers/mention.test.ts

key-decisions:
  - "Use commentId as the write idempotency anchor (stable across webhook redeliveries)"
  - "Prefer reusing existing PR over pushing new commits to the same branch"

# Metrics
duration: 20 min
completed: 2026-02-10
---

# Phase 17 Plan 01: Write-Mode Reliability Summary

**Made write-mode idempotent and retry-safe by keying write outputs to the triggering comment and reusing an existing PR when the same request is delivered again.**

## Verification

- `bun test`

## Task Commits

1. `dbdbbdf18c` feat(write): idempotent write-mode by trigger comment
