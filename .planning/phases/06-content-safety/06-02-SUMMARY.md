---
phase: 06-content-safety
plan: 02
subsystem: security
tags: [sanitization, prompt-injection, toctou, content-safety, prompt-builders]

# Dependency graph
requires:
  - phase: 06-content-safety
    provides: sanitizeContent pipeline and filterCommentsToTriggerTime from 06-01
  - phase: 05-mention-handling
    provides: mention-prompt.ts conversation context and prompt builder
  - phase: 04-pr-auto-review
    provides: review-prompt.ts PR review prompt builder
  - phase: 03-execution-engine
    provides: prompt.ts generic prompt builder
provides:
  - All user-generated content sanitized at the LLM prompt boundary
  - TOCTOU comment filtering applied before conversation context assembly
  - Complete content safety coverage across all three prompt builders
affects: [07-operational-resilience, 08-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: [boundary-sanitization, toctou-at-fetch]

key-files:
  created: []
  modified:
    - src/execution/mention-prompt.ts
    - src/execution/review-prompt.ts
    - src/execution/prompt.ts

key-decisions:
  - "diffHunk intentionally NOT sanitized (git-generated code, not user input -- per research Pitfall 5)"
  - "customInstructions intentionally NOT sanitized (controlled by repo owner via .kodiai.yml, not user input)"
  - "changedFiles intentionally NOT sanitized (file paths from git diff, not user-editable content)"
  - "TOCTOU filter applied immediately after API fetch, before any iteration over comments"
  - "conversationContext not re-sanitized in buildMentionPrompt since buildConversationContext already sanitizes"

patterns-established:
  - "Boundary sanitization: sanitizeContent called at the point user content enters prompt strings, not earlier"
  - "Selective sanitization: git-generated content and owner-controlled config exempt from sanitization"

# Metrics
duration: 2min
completed: 2026-02-08
---

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
