---
phase: quick-21
plan: 01
subsystem: mention-handler
tags: [write-intent, pr-surface, intent-detection]
dependency_graph:
  requires: []
  provides: [expanded-pr-write-intent]
  affects: [mention-handler]
tech_stack:
  added: []
  patterns: [reuse-existing-helpers]
key_files:
  created: []
  modified:
    - src/handlers/mention.ts
    - src/handlers/mention.test.ts
decisions:
  - Reuse existing isImplementationRequestWithoutPrefix and isConversationalConfirmation helpers rather than duplicating regex
  - Keep function name detectImplicitPrPatchIntent unchanged to minimize diff churn
  - Rename only the call-site variable from prPatchIntent to prWriteIntent for clarity
  - Update existing tests that asserted old narrow behavior to match expanded detection
metrics:
  duration: 224s
  completed: "2026-03-05T23:48:31Z"
  tasks: 2
  files_modified: 2
---

# Quick Task 21: Expand PR Surface Write Intent Detection Summary

Expanded PR surface implicit write-intent detection to recognize implementation verbs (fix, update, rewrite) and conversational confirmations (yes go ahead, do it) by calling existing helper functions from detectImplicitPrPatchIntent.

## What Changed

### detectImplicitPrPatchIntent expanded (src/handlers/mention.ts)

Added two calls after the existing patch-specific regex block:
- `isImplementationRequestWithoutPrefix(normalized)` -- matches fix, update, change, refactor, add, remove, implement, create, rename, rewrite, patch, write, open, submit, send, improve, tweak, clean up, clarify + code targets
- `isConversationalConfirmation(normalized)` -- matches "yes do it", "go ahead", "proceed", "sure make the PR", "sounds good go ahead"

Renamed call-site variable from `prPatchIntent` to `prWriteIntent` and updated comment from "narrow patch-specific" to "broad write intent detection".

### Tests updated (src/handlers/mention.test.ts)

- Added 5 new integration tests in "PR surface implicit write intent detection" describe block
- Updated 2 existing tests that asserted old narrow behavior (non-patch verbs on PR surfaces should NOT trigger write mode) to assert new expanded behavior (implementation verbs DO trigger write mode)
- Updated 1 clarifying fallback test to expect "Write mode is disabled" message instead of clarification prompt (correct behavior when write intent is detected but write config is off)

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | 90c1081c71 | test(quick-21): add failing tests for expanded PR write intent detection |
| 2 | 2720d8ae58 | feat(quick-21): expand PR surface write intent to recognize implementation verbs and confirmations |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing tests asserting old narrow behavior**
- **Found during:** Task 1 GREEN phase
- **Issue:** Three existing tests asserted that implementation verbs on PR surfaces did NOT trigger write mode. With the expanded detection, these assertions became incorrect.
- **Fix:** Updated test names and assertions to match new behavior: "implementation verbs on PR/review surfaces auto-promote to write mode" (writeModes true), and clarifying fallback test expects "Write mode is disabled" response.
- **Files modified:** src/handlers/mention.test.ts
- **Commit:** 2720d8ae58

## Verification

- All 86 mention handler tests pass
- isImplementationRequestWithoutPrefix and isConversationalConfirmation confirmed called inside detectImplicitPrPatchIntent (lines 368, 372)
- Existing patch-specific patterns still work (regression test passes)
- Issue surface intent detection unchanged (detectImplicitIssueIntent not modified)
