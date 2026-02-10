---
phase: 15-write-pipeline
plan: 01
subsystem: mentions
tags: [write-mode, mentions, git, pr, config, guardrails]

# Dependency graph
requires:
  - phase: 14-write-mode-foundations
    provides: write.enabled config + write-intent detection
provides:
  - Write-mode execution can edit files (no GitHub publish tools)
  - Trusted code creates branch/commit/push and opens a PR
  - Mention reply includes the created PR URL
affects: [mentions, execution, workspace]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Model edits files; trusted code publishes (branch/commit/push/PR)"
    - "Token-redacted error handling for git push (origin URL contains token)"

key-files:
  created: []
  modified:
    - src/execution/executor.ts
    - src/execution/mcp/index.ts
    - src/execution/types.ts
    - src/jobs/workspace.ts
    - src/handlers/mention.ts
    - src/handlers/mention.test.ts

key-decisions:
  - "Write-mode disables GitHub MCP publish tools; handler posts PR link instead"
  - "Write intent continues to use strict prefixes (apply:/change:)"

# Metrics
duration: 20 min
completed: 2026-02-10
---

# Phase 15 Plan 01: Mention-Driven PR Pipeline Summary

**Enabled mention-driven changes end-to-end by allowing the model to edit files, then using trusted code to commit/push and open a PR, replying with the PR link.**

## Accomplishments

- Added write-mode execution flag in `ExecutionContext` and used it to gate tools:
  - Write-mode allows edit tools.
  - Write-mode disables GitHub publish tools (comments/reviews).
- Added a workspace helper to create a branch, commit, and push, with token redaction on errors.
- Implemented the mention pipeline for `apply:` / `change:` when `write.enabled=true`:
  - Run the executor in write-mode.
  - If changes exist, publish a new PR and reply with the URL.

## Verification

- `bun test`

## Task Commits

1. `5d500a8b6c` feat(execution): add write-mode tool gating
2. `1f0a8fd09e` feat(workspace): commit and push helper with token redaction
3. `00806c2a6f` feat(mention): publish write-mode changes via PR

---
*Phase: 15-write-pipeline*
*Completed: 2026-02-10*
