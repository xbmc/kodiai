---
phase: 46-conversational-review
plan: 01
subsystem: api
tags: [mentions, github-review-comments, sqlite, prompting]
requires:
  - phase: 45-author-experience-adaptation
    provides: mention pipeline with author-tier context and prompt wiring
provides:
  - MentionEvent reply-thread parent tracking via inReplyToId
  - KnowledgeStore lookup for finding metadata by repo and comment id
  - Thread-aware mention context reconstruction for PR review replies
  - Finding-aware mention prompt preamble for contextual follow-ups
affects: [46-02, conversational-followups, mention-handler]
tech-stack:
  added: []
  patterns: [optional knowledge-store capability methods, bounded GitHub thread context reconstruction]
key-files:
  created: []
  modified:
    - src/handlers/mention-types.ts
    - src/knowledge/store.ts
    - src/execution/mention-context.ts
    - src/execution/mention-prompt.ts
    - src/handlers/mention-types.test.ts
    - src/knowledge/store.test.ts
    - src/execution/mention-context.test.ts
    - src/execution/mention-prompt.test.ts
key-decisions:
  - "Thread context fetches a single review-comments page (100 max) with deterministic filtering by thread root."
  - "Finding lookup remains optional on KnowledgeStore and mention-context accepts a callback to avoid store coupling."
patterns-established:
  - "Mention normalization populates surface-specific fields while forcing undefined for non-applicable surfaces."
  - "Review-thread context excludes the triggering comment and reuses deterministic truncation/sanitization safeguards."
duration: 4min
completed: 2026-02-14
---

# Phase 46 Plan 01: Conversational Review Summary

**Reply mentions on inline review findings now carry parent-thread IDs, recover stored finding metadata, and build thread-aware context/preamble for focused follow-up answers.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-14T17:19:24Z
- **Completed:** 2026-02-14T17:23:24Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added `inReplyToId` to mention normalization across all surfaces, including review-reply extraction from webhook payload.
- Added `getFindingByCommentId` as an optional knowledge-store API and implemented SQLite-backed lookup by repo/comment id.
- Implemented review-thread context reconstruction in `buildMentionContext` with parent-fetch fallback handling and bounded thread history.
- Added finding-specific follow-up preamble support in `buildMentionPrompt`.
- Expanded tests for normalization, store lookup, thread context behavior, missing-parent fallback, and prompt preamble rendering.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add inReplyToId to MentionEvent and getFindingByCommentId to KnowledgeStore** - `a83ee77` (feat)
2. **Task 2: Add thread-aware context building and finding-specific prompt preamble** - `620ccd1` (feat)

## Files Created/Modified
- `src/handlers/mention-types.ts` - added `inReplyToId` field and surface-specific population.
- `src/handlers/mention-types.test.ts` - added normalization tests for `in_reply_to_id` behavior.
- `src/knowledge/types.ts` - added `FindingByCommentId` type and optional store API contract.
- `src/knowledge/store.ts` - added prepared query + mapping method for finding lookup.
- `src/knowledge/store.test.ts` - added lookup test coverage for hit/miss behavior.
- `src/execution/mention-context.ts` - added review-thread context section with finding metadata and truncation guardrails.
- `src/execution/mention-context.test.ts` - added thread-context/finding/fallback tests and updated mention fixtures.
- `src/execution/mention-prompt.ts` - added optional `findingContext` preamble block.
- `src/execution/mention-prompt.test.ts` - added finding-preamble prompt test and updated mention fixture.

## Decisions Made
- Kept `getFindingByCommentId` optional on `KnowledgeStore` to match existing optional-capability patterns and preserve compatibility for lightweight store implementations.
- Implemented finding enrichment via `findingLookup` callback in `buildMentionContext` to avoid direct execution-layer dependency on storage internals.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Plan-specified build verification command used `/dev/null` as an output directory; used equivalent `bun build src/index.ts --target=bun --outdir=/tmp/kodiai-build-check` for type/build verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Mention pipeline now exposes the primitives required for fully contextual inline-thread follow-ups.
- Phase 46-02 can focus on handler wiring and end-to-end mention-response behavior.

---
*Phase: 46-conversational-review*
*Completed: 2026-02-14*

## Self-Check: PASSED

- FOUND: `.planning/phases/46-conversational-review/46-01-SUMMARY.md`
- FOUND: `a83ee77`
- FOUND: `620ccd1`
