---
id: S06
parent: M001
milestone: M001
provides:
  - sanitizeContent 7-step pipeline for stripping prompt injection vectors
  - filterCommentsToTriggerTime TOCTOU filter for comment timestamp validation
  - Individual sanitization functions exported for targeted use
  - All user-generated content sanitized at the LLM prompt boundary
  - TOCTOU comment filtering applied before conversation context assembly
  - Complete content safety coverage across all three prompt builders
requires: []
affects: []
key_files: []
key_decisions:
  - "REST API updated_at used as conservative edit timestamp (more strict than GraphQL lastEditedAt)"
  - "Strict >= comparison excludes trigger comment itself from TOCTOU-filtered results"
  - "Zero external dependencies -- pure regex/string manipulation"
  - "diffHunk intentionally NOT sanitized (git-generated code, not user input -- per research Pitfall 5)"
  - "customInstructions intentionally NOT sanitized (controlled by repo owner via .kodiai.yml, not user input)"
  - "changedFiles intentionally NOT sanitized (file paths from git diff, not user-editable content)"
  - "TOCTOU filter applied immediately after API fetch, before any iteration over comments"
  - "conversationContext not re-sanitized in buildMentionPrompt since buildConversationContext already sanitizes"
patterns_established:
  - "Sanitization pipeline: fixed 7-step order (HTML comments -> invisible chars -> markdown image alt -> link titles -> hidden attrs -> entities -> tokens)"
  - "Generic TOCTOU filter: uses TypeScript generics to work with any comment shape having created_at/updated_at"
  - "Boundary sanitization: sanitizeContent called at the point user content enters prompt strings, not earlier"
  - "Selective sanitization: git-generated content and owner-controlled config exempt from sanitization"
observability_surfaces: []
drill_down_paths: []
duration: 2min
verification_result: passed
completed_at: 2026-02-08
blocker_discovered: false
---
# S06: Content Safety

**# Phase 6 Plan 01: Content Sanitizer Summary**

## What Happened

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

# Phase 6 Plan 02: Prompt Builder Sanitization Integration Summary

**sanitizeContent wired into all 3 prompt builders covering comment bodies, PR title/body, triggerBody, and userQuestion; TOCTOU filter applied to conversation context fetch**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T15:27:40Z
- **Completed:** 2026-02-08T15:29:51Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- All user-generated content entering LLM prompts now passes through 7-step sanitization pipeline
- TOCTOU filtering excludes comments created or edited at/after trigger timestamp from conversation context
- Selective sanitization preserves git-generated content (diffHunk, changedFiles) and owner-controlled config (customInstructions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate sanitization and TOCTOU filtering into mention-prompt.ts** - `74ef711` (feat)
2. **Task 2: Integrate sanitization into review-prompt.ts and prompt.ts** - `b7a3de0` (feat)

## Files Created/Modified
- `src/execution/mention-prompt.ts` - Added sanitizeContent on comment bodies, PR title, PR body, userQuestion; added filterCommentsToTriggerTime on fetched comments
- `src/execution/review-prompt.ts` - Added sanitizeContent on prTitle and prBody
- `src/execution/prompt.ts` - Added sanitizeContent on triggerBody

## Decisions Made
- diffHunk, changedFiles, and customInstructions intentionally NOT sanitized -- these are git-generated or owner-controlled content, not user input
- TOCTOU filter applied immediately after API fetch, before iteration loop, to ensure no unsanitized comments leak through
- conversationContext not re-sanitized in buildMentionPrompt since buildConversationContext already sanitizes each piece individually

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 6 (Content Safety) is now complete -- both sanitizer module and prompt builder integration done
- All MENTION-06 (sanitization) and MENTION-07 (TOCTOU) requirements satisfied
- Ready for Phase 7 (Operational Resilience) -- timeout enforcement and error reporting

## Self-Check: PASSED

- All 4 source files exist (mention-prompt.ts, review-prompt.ts, prompt.ts, sanitizer.ts)
- Both task commits verified: 74ef711, b7a3de0
- All 3 prompt builders import sanitizeContent from lib/sanitizer
- filterCommentsToTriggerTime called in mention-prompt.ts with mention.commentCreatedAt
- 51 project tests pass, 0 failures

---
*Phase: 06-content-safety*
*Completed: 2026-02-08*
