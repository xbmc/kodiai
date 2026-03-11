---
id: S01
parent: M011
milestone: M011
provides:
  - Deterministic issue question to code-pointer extraction helper
  - Bounded path and line-anchor prompt context block for issue replies
  - Fail-open behavior for low-signal questions and adapter errors
  - Issue-surface Q&A response contract embedded directly in mention prompt instructions
  - Regression tests that lock direct-answer, path-evidence, and targeted-clarification guarantees
  - Issue-comment mention flow enriches prompts with candidate code pointers before execution
  - Issue-comment non-published success path posts targeted clarifying questions as a single reply
  - Regression coverage for issue prompt enrichment and fallback reply behavior
requires: []
affects: []
key_files: []
key_decisions:
  - "Use lightweight token/path/content scoring instead of embeddings to keep extraction deterministic and dependency-free."
  - "Treat weak-signal and adapter-failure cases as empty-context fail-open responses rather than blocking issue replies."
  - "Issue Q&A guarantees are gated to mention.surface === issue_comment to avoid changing PR-specific response behavior."
  - "Path evidence guidance standardizes concrete path formatting (path or path:line) and requires claim-to-path linkage."
  - "Apply buildIssueCodeContext only for mention.surface === issue_comment before prompt construction."
  - "Use issue-specific fallback questions that ask for desired outcome, target files/areas, and constraints when published output is absent."
patterns_established:
  - "Issue context helpers should return both structured data and prompt-ready contextBlock text."
  - "Ranking outputs must use deterministic ordering with explicit tie-breakers."
  - "Issue prompt contract first, handler wiring later: quality guarantees are encoded and tested before integration plans."
  - "Issue prompt enrichment: append '## Candidate Code Pointers' plus extracted contextBlock when non-empty."
  - "Fallback resilience: keep fail-open behavior for issue context extraction and post one targeted clarifying reply on non-published success."
observability_surfaces: []
drill_down_paths: []
duration: 3 min
verification_result: passed
completed_at: 2026-02-16
blocker_discovered: false
---
# S01: Issue Q A

**# Phase 60 Plan 02: Issue Code Context Summary**

## What Happened

# Phase 60 Plan 02: Issue Code Context Summary

**Bounded issue question analysis now surfaces deterministic file-path pointers with optional line anchors for mention replies.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T06:03:06Z
- **Completed:** 2026-02-16T06:06:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `buildIssueCodeContext` with bounded tokenization, repo file filtering, and deterministic ranking.
- Added prompt-ready `contextBlock` generation and structured pointer output including optional line anchors.
- Added deterministic tests covering strong signal, weak signal, dedupe/max cap, tie ordering, and fail-open adapter errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement bounded issue code-context extractor** - `d8e496a70f` (feat)
2. **Task 2: Add deterministic tests for code-pointer extraction quality** - `85807077e2` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/execution/issue-code-context.ts` - Pure helper that derives bounded code pointers from issue questions.
- `src/execution/issue-code-context.test.ts` - Deterministic adapter-driven tests for ranking quality and fail-open safety.

## Decisions Made
- Used adapter injection (`globFiles`, `grepInFiles`, `readFile`) to keep extraction testable and deterministic without external services.
- Kept weak-signal threshold conservative (strongest score must be >= 2) so low-context questions degrade to empty output.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `buildIssueCodeContext` is ready to be wired into issue mention handling in Plan 60-03.
- Deterministic tests provide a stable contract for future handler integration.

## Self-Check: PASSED

- FOUND: `src/execution/issue-code-context.ts`
- FOUND: `src/execution/issue-code-context.test.ts`
- FOUND: `d8e496a70f`
- FOUND: `85807077e2`

---
*Phase: 60-issue-q-a*
*Completed: 2026-02-16*

# Phase 60 Plan 01: Issue Q&A Contract Summary

**Issue mentions now require a direct first-sentence answer, evidence-backed repository path pointers, and targeted clarification questions when code context is missing.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-16T06:03:12Z
- **Completed:** 2026-02-16T06:04:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added an explicit `Issue Q&A Requirements` block in `buildMentionPrompt()` for `issue_comment` surface only.
- Encoded mandatory direct-answer-first behavior, concrete file-path evidence requirements, and anti-fabrication fallback guidance.
- Added regression tests that fail if issue-only prompt guarantees are removed or leaked onto non-issue surfaces.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add issue-specific answer quality contract to mention prompt** - `9ab8c24e25` (feat)
2. **Task 2: Add regression tests for issue Q&A prompt guarantees** - `46e3c34f4f` (test)

## Files Created/Modified
- `.planning/phases/60-issue-q-a/60-01-SUMMARY.md` - Execution summary with decisions, metrics, and validation notes
- `src/execution/mention-prompt.ts` - Added issue-surface response contract block for Q&A quality constraints
- `src/execution/mention-prompt.test.ts` - Added issue-surface contract assertions and non-issue gating regression test

## Decisions Made
- Gated issue Q&A requirements to `mention.surface === "issue_comment"` so PR/review mention behavior remains unchanged.
- Kept path guidance concrete (`src/file.ts` / `src/file.ts:42`) and paired with explicit anti-fabrication fallback.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 60 plan 01 output is complete and verified; ready for `60-02-PLAN.md`.

---
*Phase: 60-issue-q-a*
*Completed: 2026-02-16*

## Self-Check: PASSED

- FOUND: `.planning/phases/60-issue-q-a/60-01-SUMMARY.md`
- FOUND: `9ab8c24e25`
- FOUND: `46e3c34f4f`

# Phase 60 Plan 03: Issue Mention Wiring Summary

**Issue mentions now receive prompt-time candidate code pointers and a deterministic targeted clarification fallback when no response is published.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T06:07:30Z
- **Completed:** 2026-02-16T06:10:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Wired issue-only code-pointer enrichment into mention execution before `buildMentionPrompt()`.
- Preserved fail-open behavior: issue context extraction errors or weak signals do not block mention handling.
- Added issue-comment regression tests for prompt enrichment, targeted fallback questions, and single-reply fallback behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate issue code-pointer context into mention handling** - `86e3b253a4` (feat)
2. **Task 2: Add issue Q&A regression tests for direct answer and targeted clarification fallback** - `665001f692` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/handlers/mention.ts` - Adds issue-only `buildIssueCodeContext` enrichment and issue-specific fallback question copy.
- `src/handlers/mention.test.ts` - Adds issue-comment fixtures and regression tests for context pointers and fallback behavior.
- `.planning/phases/60-issue-q-a/60-03-SUMMARY.md` - Execution summary and metadata for this plan.

## Decisions Made
- Scoped code-pointer enrichment strictly to `mention.surface === "issue_comment"` to avoid behavior changes for PR mention surfaces.
- Kept fallback behavior single-comment and issue-targeted when execution succeeds without published output.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 60 Plan 03 outcomes satisfy ISSUE-01 runtime wiring for issue mention direct-answer context and clarifying fallback behavior.
- Ready for Phase 61 (read-only and intent gating for issue flows).

## Self-Check: PASSED

- FOUND: `.planning/phases/60-issue-q-a/60-03-SUMMARY.md`
- FOUND: `86e3b253a4`
- FOUND: `665001f692`

---
*Phase: 60-issue-q-a*
*Completed: 2026-02-16*
