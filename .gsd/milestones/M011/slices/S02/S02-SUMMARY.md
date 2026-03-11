---
id: S02
parent: M011
milestone: M011
provides:
  - Runtime issue-comment detector that blocks non-prefixed implementation asks before execution
  - Deterministic read-only issue reply with exact apply/change opt-in commands
  - Regression coverage for SAFE-01 and ISSUE-02 issue-surface intent behavior
  - Issue-only read-only default contract for non-prefixed implementation requests
  - Exact write opt-in command guidance using @kodiai apply:/change: forms
  - Regression tests preventing instruction leakage to non-issue surfaces
  - Fail-closed implementation-intent detection for wrapped or conversational issue asks
  - Issue prompt contract that forbids read-only completion claims without apply/change prefixes
  - Regression tests covering live trigger phrasing, formatted variants, and issue informational pass-through
requires: []
affects: []
key_files: []
key_decisions:
  - "Gate issue implementation asks before executor invocation by matching conservative implementation verbs when no apply:/change:/plan: prefix is present."
  - "Post issue opt-in guidance through direct issue comment creation so exact @kodiai apply/change commands are preserved in output."
  - "Read-only guidance is explicit and default on issue_comment unless a message starts with apply: or change:."
  - "Change-request replies without write prefixes must include both exact opt-in commands: @kodiai apply: <same request> and @kodiai change: <same request>."
  - "Normalize issue requests before intent matching and before generating apply/change command suggestions so wrapped phrasing stays deterministic."
  - "Add explicit anti-completion wording to issue prompt requirements to prevent non-prefixed read-only replies from implying repository edits were already made."
patterns_established:
  - "Issue runtime intent gate: mention.surface === issue_comment + non-prefixed implementation ask -> deterministic opt-in command reply and early return."
  - "Phase 61 safety behavior: explicit issue apply/change remains non-writing and responds with PR-context-only guidance."
  - "Issue intent gating is encoded in prompt contract first, then enforced at runtime in follow-up plans."
  - "Issue gate normalization pattern: strip quote/list/punctuation/preamble wrappers before classifying implementation intent."
  - "Issue prompt safety pattern: include forbidden completion language list plus exact apply/change opt-in commands for implementation asks without prefixes."
observability_surfaces: []
drill_down_paths: []
duration: 2 min
verification_result: passed
completed_at: 2026-02-16
blocker_discovered: false
---
# S02: Read Only Intent Gating

**# Phase 61 Plan 02: Runtime Issue Intent Gating Summary**

## What Happened

# Phase 61 Plan 02: Runtime Issue Intent Gating Summary

**Issue-thread implementation asks now stop at a runtime read-only gate unless users explicitly prefix with `apply:` or `change:`, with deterministic opt-in commands returned in-thread.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T06:31:51Z
- **Completed:** 2026-02-16T06:34:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added issue-surface runtime intent detection that blocks non-prefixed implementation requests before executor/write flow.
- Returned exact opt-in commands (`@kodiai apply:` / `@kodiai change:`) for non-prefixed change asks in issue comments.
- Added regression tests for non-prefixed change gating, non-change issue Q&A passthrough, and explicit issue `apply:` non-writing safety.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add issue-surface runtime intent gate and deterministic opt-in reply** - `5566bc33ed` (feat)
2. **Task 2: Add handler tests for SAFE-01 and prefix command guidance** - `8e330cabad` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/handlers/mention.ts` - Adds non-prefixed issue implementation detector and deterministic read-only opt-in command reply path.
- `src/handlers/mention.test.ts` - Adds focused issue intent-gating regression tests and aligns fallback question fixture with non-change Q&A behavior.
- `.planning/phases/61-read-only-intent-gating/61-02-SUMMARY.md` - Execution summary and metadata for this plan.

## Decisions Made
- Applied runtime intent gating only for `mention.surface === "issue_comment"` so PR mention surfaces keep existing behavior.
- Preserved exact `@kodiai` command prefixes in the opt-in guidance response to satisfy deterministic copy/paste UX.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stale fallback test fixture after runtime gate introduction**
- **Found during:** Task 1 (Add issue-surface runtime intent gate and deterministic opt-in reply)
- **Issue:** Existing fallback test used a non-prefixed implementation ask (`can you fix ...`) that now correctly triggers the new gate before executor fallback behavior.
- **Fix:** Switched that fixture to an informational issue question so it continues validating non-published fallback behavior without conflicting with new intent gating.
- **Files modified:** src/handlers/mention.test.ts
- **Verification:** `bun test src/handlers/mention.test.ts --timeout 30000`
- **Committed in:** `5566bc33ed` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Change was required to keep legacy coverage aligned with the new runtime gate; no scope creep.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SAFE-01 runtime gate and ISSUE-02 opt-in command UX are now enforced in handler logic for issue comments.
- Ready for remaining Phase 61 plan sequencing and Phase 62 issue write-mode PR flow.

## Self-Check: PASSED

- FOUND: `.planning/phases/61-read-only-intent-gating/61-02-SUMMARY.md`
- FOUND: `5566bc33ed`
- FOUND: `8e330cabad`

---
*Phase: 61-read-only-intent-gating*
*Completed: 2026-02-16*

# Phase 61 Plan 01: Read-Only Prompt Contract Summary

**Issue-thread mention guidance now defaults to explicit read-only framing and requires exact apply/change opt-in command examples whenever implementation is requested without write prefixes.**

## Performance

- **Duration:** 0 min
- **Started:** 2026-02-16T06:31:52Z
- **Completed:** 2026-02-16T06:32:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added issue-surface read-only default language to `buildMentionPrompt()` clarifying no implied edits/branch pushes/PR creation without `apply:` or `change:`.
- Added explicit dual-command opt-in contract requiring `@kodiai apply: <same request>` and `@kodiai change: <same request>` in non-prefixed change requests.
- Added regression assertions ensuring these rules appear only for issue surfaces and do not leak into non-issue prompts.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add explicit issue read-only framing and opt-in command contract** - `4d5399e39b` (feat)
2. **Task 2: Add prompt regression tests for read-only and exact opt-in command wording** - `1569abc89e` (test)

## Files Created/Modified
- `.planning/phases/61-read-only-intent-gating/61-01-SUMMARY.md` - Plan execution summary with decisions and verification status
- `src/execution/mention-prompt.ts` - Issue-surface prompt contract now includes read-only default and exact write opt-in command wording
- `src/execution/mention-prompt.test.ts` - Regression tests for issue-only read-only framing and exact command examples

## Decisions Made
- Kept intent gating scoped to `mention.surface === "issue_comment"` so existing PR/review mention behavior remains unchanged.
- Required exact, copyable write opt-in commands for non-prefixed implementation requests to make safe escalation explicit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 61 plan 01 prompt contract and tests are complete; ready for `61-02-PLAN.md` runtime intent gating.

---
*Phase: 61-read-only-intent-gating*
*Completed: 2026-02-16*

## Self-Check: PASSED

- FOUND: `.planning/phases/61-read-only-intent-gating/61-01-SUMMARY.md`
- FOUND: `4d5399e39b`
- FOUND: `1569abc89e`

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
