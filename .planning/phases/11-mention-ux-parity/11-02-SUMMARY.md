---
phase: 11-mention-ux-parity
plan: 02
subsystem: mentions
tags: [octokit, mentions, prompt, sanitization, toctou, bun]

# Dependency graph
requires:
  - phase: 11-mention-ux-parity
    provides: mention event normalization + config gating + eyes-only tracking behavior
provides:
  - Context builder for mention replies (conversation + PR metadata + inline diff context)
  - Mention prompt includes bounded context and "reply only if useful" rules
affects: [mention-handling, prompt-safety, execution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Deterministic, bounded prompt context construction for user-generated threads
    - TOCTOU filtering (created_at/updated_at) applied before any LLM exposure

key-files:
  created:
    - src/execution/mention-context.ts
    - src/execution/mention-context.test.ts
  modified:
    - src/handlers/mention.ts
    - src/handlers/mention-types.ts
    - src/execution/mention-prompt.ts

key-decisions:
  - "Default context bounds: last 20 comments, 800 chars per comment, 1200 chars for PR body"
  - "Context build failures are non-fatal; proceed with empty context to avoid dropping mention replies"

patterns-established:
  - "Mention context builder is a dedicated module (buildMentionContext) rather than being embedded in prompt construction"

# Metrics
duration: 5 min
completed: 2026-02-09
---

# Phase 11 Plan 02: Mention Context Builder Summary

**Bounded, TOCTOU-safe mention context (thread + PR + inline diff) is now injected into the mention prompt, enabling contextual replies without adding any tracking comments.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-09T22:59:06Z
- **Completed:** 2026-02-09T23:04:26Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `buildMentionContext()` that fetches recent thread comments, applies TOCTOU filtering, sanitizes content, and deterministically bounds/truncates prompt context.
- Included PR metadata (title/author/branches/description) and inline review context (file/line + diff hunk) when available.
- Wired context into the mention handler and tightened prompt language to avoid ack/tracking noise (eyes reaction remains the only tracking signal).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create a mention context builder with TOCTOU + sanitization** - `2aa5c7ea12` (feat)
2. **Task 2: Wire context into mention handler and tighten prompt rules** - `12f36ae98b` (feat)

## Files Created/Modified

- `src/execution/mention-context.ts` - Builds bounded, sanitized context for mention replies (thread + PR + inline review).
- `src/execution/mention-context.test.ts` - Tests TOCTOU exclusion, sanitization, deterministic truncation, and inline review context inclusion.
- `src/handlers/mention-types.ts` - Extends normalized review comment surface with optional file/line metadata.
- `src/handlers/mention.ts` - Builds mention context before executor and passes it into the prompt builder.
- `src/execution/mention-prompt.ts` - Accepts `mentionContext` and clarifies "reply only when useful" / no tracking comment rules.

## Decisions Made

- Default bounds chosen to keep prompts small but useful: last 20 comments, 800 chars/comment, 1200 chars PR body.
- Context fetch is best-effort; failures do not drop mention processing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Mention replies now have contextual grounding (conversation + PR context) while preserving eyes-only tracking.
- Ready for follow-up plans that tune formatting/structure or add additional PR surfaces (e.g., commits/files summaries) if desired.

---
*Phase: 11-mention-ux-parity*
*Completed: 2026-02-09*

## Self-Check: PASSED
