---
phase: 06-content-safety
plan: 01
subsystem: security
tags: [sanitization, prompt-injection, toctou, regex, content-safety]

# Dependency graph
requires:
  - phase: 05-mention-handling
    provides: Mention handler and conversation context builder that will consume sanitizer
provides:
  - sanitizeContent 7-step pipeline for stripping prompt injection vectors
  - filterCommentsToTriggerTime TOCTOU filter for comment timestamp validation
  - Individual sanitization functions exported for targeted use
affects: [06-content-safety, 07-operational-resilience]

# Tech tracking
tech-stack:
  added: []
  patterns: [layered-sanitization-pipeline, toctou-timestamp-filtering]

key-files:
  created:
    - src/lib/sanitizer.ts
    - src/lib/sanitizer.test.ts
  modified: []

key-decisions:
  - "REST API updated_at used as conservative edit timestamp (more strict than GraphQL lastEditedAt)"
  - "Strict >= comparison excludes trigger comment itself from TOCTOU-filtered results"
  - "Zero external dependencies -- pure regex/string manipulation"

patterns-established:
  - "Sanitization pipeline: fixed 7-step order (HTML comments -> invisible chars -> markdown image alt -> link titles -> hidden attrs -> entities -> tokens)"
  - "Generic TOCTOU filter: uses TypeScript generics to work with any comment shape having created_at/updated_at"

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 6 Plan 01: Content Sanitizer Summary

**7-step regex sanitization pipeline and TOCTOU timestamp filter ported from claude-code-action reference implementation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T15:22:16Z
- **Completed:** 2026-02-08T15:24:52Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Content sanitizer with 7 chained steps stripping HTML comments, invisible Unicode, markdown hidden text, HTML attributes, entity encoding, and GitHub tokens
- TOCTOU comment filter using >= timestamp comparison to exclude post-trigger and at-trigger comments
- 44 unit tests covering all 9 exported functions with 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Create content sanitizer and TOCTOU filter module** - `b4852b2` (feat)
2. **Task 2: Create comprehensive unit tests** - `108c2e1` (test)

## Files Created/Modified
- `src/lib/sanitizer.ts` - Content sanitization pipeline (7 functions) + TOCTOU filter + sanitizeContent orchestrator (205 lines)
- `src/lib/sanitizer.test.ts` - Comprehensive tests for all 9 exported functions (346 lines, 44 tests)

## Decisions Made
- REST API `updated_at` used as conservative edit timestamp -- changes on any update (edits, reactions, labels), more strict than GraphQL `lastEditedAt`
- Strict `>=` comparison in TOCTOU filter excludes the trigger comment itself (per Pitfall 4 in research)
- Zero external dependencies -- all sanitization is pure regex/string manipulation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Sanitizer and TOCTOU filter ready for Plan 02 integration into prompt builders
- All functions exported individually for targeted use in buildConversationContext, buildMentionPrompt, buildReviewPrompt

---
*Phase: 06-content-safety*
*Completed: 2026-02-08*
