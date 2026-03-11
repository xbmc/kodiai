---
id: T01
parent: S02
milestone: M023
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: ~5min
verification_result: passed
completed_at: 2026-02-27
blocker_discovered: false
---
# T01: 111-troubleshooting-agent 01

**# Phase 111 Plan 01: Intent Classifier & Marker Dedup Summary**

## What Happened

# Phase 111 Plan 01: Intent Classifier & Marker Dedup Summary

Compound keyword intent classifier, comment-scoped marker dedup, and troubleshooting.synthesis task type registration.

## What Was Done

### Task 1: Intent classifier and comment-scoped marker dedup

Created `src/handlers/troubleshooting-intent.ts` with four exports:

- **`classifyTroubleshootingIntent()`** -- Pure function using compound keyword heuristic (TSHOOT-06). Checks `PROBLEM_KEYWORDS` (19 terms: crash, error, bug, broken, fail, etc.) against issue title+body and `HELP_KEYWORDS` (15 terms: troubleshoot, debug, help, how to fix, etc.) against mention text. Returns true only when both signals present.
- **`TROUBLESHOOT_MARKER_PREFIX`** -- String constant `"kodiai:troubleshoot"`.
- **`buildTroubleshootMarker(repo, issueNumber, triggerCommentId)`** -- Produces HTML comment `<!-- kodiai:troubleshoot:{repo}:{issueNumber}:comment-{commentId} -->` keyed by trigger comment ID (TSHOOT-08).
- **`hasTroubleshootMarker(comments, triggerCommentId)`** -- Scans comment bodies for marker matching specific trigger comment ID.

Created `src/handlers/troubleshooting-intent.test.ts` with 13 tests:
- 8 intent classification tests (true positives, true negatives, case insensitivity, null body)
- 1 marker format test
- 4 marker detection tests (match, no match, different ID, null/undefined body)

**Commit:** `e5abedf36d`

### Task 2: Add troubleshooting.synthesis task type

Added `TROUBLESHOOTING_SYNTHESIS: "troubleshooting.synthesis"` to `TASK_TYPES` in `src/llm/task-types.ts`. Deliberately NOT added to `AGENTIC_TASK_TYPES` -- troubleshooting synthesis is stateless text generation via `generateWithFallback()`, no MCP tools or workspace needed.

**Commit:** `7e756f1252`

## Verification

- `bun test src/handlers/troubleshooting-intent.test.ts` -- 13/13 pass
- `bun build src/handlers/troubleshooting-intent.ts --no-bundle` -- compiles clean
- `bun build src/llm/task-types.ts --no-bundle` -- compiles clean
- `TROUBLESHOOT_MARKER_PREFIX` exported from troubleshooting-intent.ts (confirmed via grep)
- `troubleshooting.synthesis` NOT in AGENTIC_TASK_TYPES (confirmed via grep)

## Deviations from Plan

None -- plan executed exactly as written.
