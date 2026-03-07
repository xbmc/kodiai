---
phase: 126-global-anti-hallucination-guardrails
plan: 03
subsystem: guardrail
tags: [anti-hallucination, surface-adapter, mention, slack, troubleshoot, triage, wiki]

requires:
  - phase: 126-01
    provides: SurfaceAdapter interface, GroundingContext type, context-classifier, pipeline
  - phase: claim-classifier
    provides: extractClaims function, parseDiffForClassifier utility
provides:
  - Mention surface adapter for @mention responses on issues/PRs
  - Slack surface adapter for Slack assistant responses
  - Troubleshoot surface adapter for troubleshooting agent guidance
  - Triage surface adapter for issue triage validation comments
  - Wiki surface adapter replacing checkGrounding() with richer PR-patch grounding
affects: [126-04-integration, mention-handler, slack-assistant, troubleshooting-agent, wiki-update-generator]

tech-stack:
  added: []
  patterns: [text-based-adapter-pattern, template-preservation, orphan-heading-removal, code-block-preservation]

key-files:
  created:
    - src/lib/guardrail/adapters/mention-adapter.ts
    - src/lib/guardrail/adapters/slack-adapter.ts
    - src/lib/guardrail/adapters/troubleshoot-adapter.ts
    - src/lib/guardrail/adapters/triage-adapter.ts
    - src/lib/guardrail/adapters/wiki-adapter.ts
    - src/lib/guardrail/adapters/mention-adapter.test.ts
    - src/lib/guardrail/adapters/slack-adapter.test.ts
    - src/lib/guardrail/adapters/troubleshoot-adapter.test.ts
    - src/lib/guardrail/adapters/triage-adapter.test.ts
    - src/lib/guardrail/adapters/wiki-adapter.test.ts
  modified: []

key-decisions:
  - "Code blocks in mention adapter are always preserved (never filtered inside fenced code blocks)"
  - "Mention reconstructOutput uses sentence-level filtering within lines, not line-level matching"
  - "Triage template line detection matches any line starting with HTML tag (not just self-closing)"
  - "Wiki adapter preserves {{template}} markers regardless of claim classification"
  - "Wiki adapter grounds PR citations via patch content in providedContext, replacing binary checkGrounding()"

patterns-established:
  - "Text-based adapter pattern: reuse extractClaims() from claim-classifier.ts for all text surfaces"
  - "Template preservation: template/structural lines bypass claim filtering entirely"
  - "Orphan heading removal: headings with no content below them (before next heading or end) are removed"
  - "Code block preservation: fenced code blocks (```) treated as atomic units, never split or filtered"

requirements-completed: [GUARD-07, GUARD-08]

duration: 4min
completed: 2026-03-07
---

# Phase 126 Plan 03: Non-Review Surface Adapters Summary

**Five surface adapters (mention, slack, troubleshoot, triage, wiki) implementing SurfaceAdapter interface with surface-specific claim extraction, context building, and output reconstruction**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T09:13:08Z
- **Completed:** 2026-03-07T09:17:06Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Built five surface adapters covering all non-review output surfaces
- Each adapter extracts claims via shared extractClaims(), builds surface-specific grounding context, and reconstructs output preserving structural elements
- Wiki adapter provides richer grounding than existing checkGrounding() by using full PR patch content as context
- Mention adapter handles markdown with code block preservation and orphan heading removal
- Triage adapter filters prose while preserving table rows and HTML template structure
- All thresholds match research recommendations: mention=15, slack=5, troubleshoot=20, triage=10, wiki=10

## Task Commits

Each task was committed atomically:

1. **Task 1: Create mention, slack, and troubleshoot adapters** - `79afa8864e` (feat)
2. **Task 2: Create triage and wiki adapters** - `1fa1268f04` (feat)

_Note: TDD tasks have RED+GREEN in single commits (tests + implementation together)_

## Files Created/Modified
- `src/lib/guardrail/adapters/mention-adapter.ts` - @mention surface adapter with markdown/code block handling
- `src/lib/guardrail/adapters/slack-adapter.ts` - Slack assistant adapter with lenient threshold
- `src/lib/guardrail/adapters/troubleshoot-adapter.ts` - Troubleshoot agent adapter preserving bullet points
- `src/lib/guardrail/adapters/triage-adapter.ts` - Triage adapter filtering prose while keeping tables/HTML
- `src/lib/guardrail/adapters/wiki-adapter.ts` - Wiki adapter with template marker preservation and PR patch grounding
- `src/lib/guardrail/adapters/*-adapter.test.ts` - Test suites for all five adapters (55 tests total)

## Decisions Made
- Code blocks in mention adapter always preserved (never filtered inside fenced code blocks)
- Mention reconstructOutput uses sentence-level filtering within lines (not line-level matching) for accuracy
- Triage template line detection matches any line starting with HTML tag to catch `<summary>content</summary>` patterns
- Wiki adapter preserves {{template}} markers regardless of claim classification
- Wiki adapter grounds PR citations via patch content in providedContext, replacing binary checkGrounding()

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mention reconstructOutput line-level matching**
- **Found during:** Task 1 (mention adapter)
- **Issue:** Line-level matching kept entire lines containing both kept and removed claims (e.g., "First claim. Second claim." kept both when only "First claim." was in keptClaims)
- **Fix:** Changed to sentence-level filtering using extractClaims() within each line
- **Files modified:** src/lib/guardrail/adapters/mention-adapter.ts
- **Verification:** Test "joins kept claims into text" passes
- **Committed in:** 79afa8864e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix necessary for correctness of claim filtering. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All five surface adapters ready to be wired into their respective handlers (plan 04)
- No handler files modified yet -- adapters are standalone modules
- All existing guardrail tests continue to pass (95 tests across 11 files)

---
*Phase: 126-global-anti-hallucination-guardrails*
*Completed: 2026-03-07*
