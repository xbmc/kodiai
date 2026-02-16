---
phase: 61-read-only-intent-gating
plan: 03
subsystem: api
tags: [mentions, issue-comment, intent-gating, prompt-guardrails, safety]

# Dependency graph
requires:
  - phase: 61-02
    provides: Runtime issue intent gate and deterministic issue opt-in reply format
provides:
  - Fail-closed implementation-intent detection for wrapped or conversational issue asks
  - Issue prompt contract that forbids read-only completion claims without apply/change prefixes
  - Regression tests covering live trigger phrasing, formatted variants, and issue informational pass-through
affects: [phase-62, issue-write-mode, mention-handler, prompt-contract]

# Tech tracking
tech-stack:
  added: []
  patterns: [wrapper normalization before intent matching, read-only anti-completion prompt constraints, trigger-text regression coverage]

key-files:
  created: [.planning/phases/61-read-only-intent-gating/61-03-SUMMARY.md]
  modified: [src/handlers/mention.ts, src/handlers/mention.test.ts, src/execution/mention-prompt.ts, src/execution/mention-prompt.test.ts]

key-decisions:
  - "Normalize issue requests before intent matching and before generating apply/change command suggestions so wrapped phrasing stays deterministic."
  - "Add explicit anti-completion wording to issue prompt requirements to prevent non-prefixed read-only replies from implying repository edits were already made."

patterns-established:
  - "Issue gate normalization pattern: strip quote/list/punctuation/preamble wrappers before classifying implementation intent."
  - "Issue prompt safety pattern: include forbidden completion language list plus exact apply/change opt-in commands for implementation asks without prefixes."

# Metrics
duration: 2 min
completed: 2026-02-16
---

# Phase 61 Plan 03: Live Gap Closure Summary

**Issue-comment intent gating now catches wrapped implementation asks and enforces read-only response wording that never implies completed edits without explicit `apply:`/`change:` intent.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T16:44:40Z
- **Completed:** 2026-02-16T16:47:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Hardened `isImplementationRequestWithoutPrefix` by normalizing quote/list/punctuation/preamble wrappers and expanding rewrite-style implementation intent detection.
- Added issue prompt guardrails that explicitly forbid completion-status wording for non-prefixed issue comments.
- Added regression tests for Trigger A phrasing, formatted variant normalization, and preservation of normal executor flow for informational issue Q&A.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden issue implementation-intent detection and keep the gate fail-closed** - `d6e389aea3` (fix)
2. **Task 2: Add defense-in-depth prompt guardrails and regression tests for non-prefixed issue edits** - `b79c172c9f` (fix)

**Plan metadata:** pending

## Files Created/Modified
- `src/handlers/mention.ts` - Adds reusable issue wrapper stripping for intent detection and opt-in command request normalization.
- `src/handlers/mention.test.ts` - Adds Trigger A exact-phrase and formatted-variant gating regressions while preserving informational issue executor coverage.
- `src/execution/mention-prompt.ts` - Adds issue-only anti-completion wording constraint for read-only responses.
- `src/execution/mention-prompt.test.ts` - Enforces prompt contract coverage for anti-completion and exact opt-in command guidance.
- `.planning/phases/61-read-only-intent-gating/61-03-SUMMARY.md` - Plan execution summary and metadata.

## Decisions Made
- Expanded implementation-intent matching to include rewrite/copy-edit phrasing only when tied to repository-oriented targets, keeping informational questions ungated.
- Normalized wrapped issue requests before composing opt-in commands so deterministic guidance is clean and copy/paste ready.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Strip wrapper text from opt-in command suggestions**
- **Found during:** Task 2 (Add defense-in-depth prompt guardrails and regression tests for non-prefixed issue edits)
- **Issue:** Formatted issue requests such as `> quick question: ...` were correctly gated but command suggestions echoed wrapper text verbatim.
- **Fix:** Reused wrapper-stripping normalization before building `@kodiai apply:` and `@kodiai change:` guidance text.
- **Files modified:** src/handlers/mention.ts
- **Verification:** `bun test src/handlers/mention.test.ts --timeout 30000`
- **Committed in:** `b79c172c9f` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix improved deterministic guidance quality without expanding scope.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 61 intent gating now covers live non-prefixed implementation phrasing and read-only anti-completion prompt safety.
- Ready to proceed with Phase 62 issue write-mode PR creation work.

## Self-Check: PASSED

- FOUND: `.planning/phases/61-read-only-intent-gating/61-03-SUMMARY.md`
- FOUND: `d6e389aea3`
- FOUND: `b79c172c9f`

---
*Phase: 61-read-only-intent-gating*
*Completed: 2026-02-16*
