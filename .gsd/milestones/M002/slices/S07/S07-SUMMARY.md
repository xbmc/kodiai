---
id: S07
parent: M002
milestone: M002
provides:
  - Secret regex scanning reduced false positives by evaluating staged additions only
  - Write-policy refusal UX includes explicit no-changes next action
  - Runbook reason-code quick map for faster operator triage
  - Idempotent write-mode keyed by trigger comment
  - Existing PR discovery to avoid duplicate work on retries/redeliveries
  - Best-effort in-process lock for duplicate concurrent handling
requires: []
affects: []
key_files: []
key_decisions:
  - "Use commentId as the write idempotency anchor (stable across webhook redeliveries)"
  - "Prefer reusing existing PR over pushing new commits to the same branch"
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 20 min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# S07: Write Mode Reliability

**# Phase 17 Plan 02: Write-Mode Reliability Summary**

## What Happened

# Phase 17 Plan 02: Write-Mode Reliability Summary

Improved write-mode reliability with safer secret-scan behavior and clearer operator/user guidance.

## What changed

- Secret regex scanning now evaluates staged additions per file (not whole patch), so removing old secret-like lines no longer triggers false-positive refusals.
- Added write-policy `no-changes` refusal guidance with an explicit next action.
- Added runbook quick map from refusal reason codes to immediate operator actions.
- Added regression test proving secret-like content removal is allowed.

Files changed:

- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `docs/runbooks/mentions.md`

## Verification

- `bun test`
- `bunx tsc --noEmit`

# Phase 17 Plan 01: Write-Mode Reliability Summary

**Made write-mode idempotent and retry-safe by keying write outputs to the triggering comment and reusing an existing PR when the same request is delivered again.**

## Verification

- `bun test`

## Task Commits

1. `dbdbbdf18c` feat(write): idempotent write-mode by trigger comment
