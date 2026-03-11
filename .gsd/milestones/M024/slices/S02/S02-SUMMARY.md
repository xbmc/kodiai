---
id: S02
parent: M024
milestone: M024
provides:
  - Shared epistemic guardrails across all three bot response surfaces (PR review, mentions, Slack assistant)
  - Surface-neutral language in buildEpistemicBoundarySection()
  - Context-visible tier adaptation for issue mentions
requires: []
affects: []
key_files: []
key_decisions:
  - "Scoped Slack hedge rule to visible context only, replacing blanket 'Never hedge' to reconcile with epistemic omission"
  - "Inserted epistemic section before Slack message content for consistent prompt structure"
patterns_established:
  - "Shared epistemic section: all surfaces import buildEpistemicBoundarySection() from review-prompt.ts"
  - "Surface-specific adaptation: issue mentions add context-visible tier, Slack scopes hedge rule"
observability_surfaces: []
drill_down_paths: []
duration: 8min
verification_result: passed
completed_at: 2026-03-02
blocker_discovered: false
---
# S02: Cross Surface Epistemic Guardrails

**# Plan 116-01: Cross-Surface Epistemic Guardrails Summary**

## What Happened

# Plan 116-01: Cross-Surface Epistemic Guardrails Summary

**Shared 3-tier epistemic boundary system propagated to mention and Slack surfaces with surface-neutral language and context-visible adaptations**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-02
- **Completed:** 2026-03-02
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Generalized buildEpistemicBoundarySection() to surface-neutral language ("your response" instead of "this review")
- Integrated shared epistemic section into mention prompt, replacing old "Factual Accuracy -- CRITICAL" section
- Added context-visible tier adaptation for issue mentions (non-PR context)
- Integrated shared epistemic section into Slack assistant prompt with reconciled hedge rules
- All 194 tests pass across review-prompt, mention-prompt, and assistant-handler test files

## Task Commits

Each task was committed atomically:

1. **Task A: Generalize epistemic boundary section** - `8477e801a9` (feat)
2. **Task B: Integrate epistemic guardrails into mention prompt** - `6ad718fb01` (feat)
3. **Task C: Integrate epistemic guardrails into Slack assistant** - `3c2aa16e0e` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Generalized buildEpistemicBoundarySection() and buildToneGuidelinesSection() to surface-neutral language
- `src/execution/mention-prompt.ts` - Imported shared epistemic section, replaced old Factual Accuracy section, added issue context-visible tier
- `src/slack/assistant-handler.ts` - Imported shared epistemic section, scoped hedge rule to visible context only
- `src/execution/review-prompt.test.ts` - Tests for surface-neutral language in epistemic section
- `src/execution/mention-prompt.test.ts` - Tests for epistemic section in PR and issue mention prompts
- `src/slack/assistant-handler.test.ts` - Tests for epistemic section presence and hedge rule reconciliation

## Decisions Made
- Scoped Slack "Never hedge" to "For things you can see in the codebase: state definitively" to reconcile with epistemic "silently omit" rule
- Placed epistemic section before "Slack message:" content in Slack prompt for consistent structure

## Deviations from Plan

None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Epistemic guardrails now consistent across all three bot surfaces
- PROMPT-04 requirement fully satisfied
- Ready for post-generation fact-verification layer (if planned in subsequent phases)

---
*Phase: 116-cross-surface-epistemic-guardrails*
*Completed: 2026-03-02*
