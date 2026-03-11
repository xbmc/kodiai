---
id: S01
parent: M024
milestone: M024
provides:
  - buildEpistemicBoundarySection() helper with three-tier knowledge classification
  - Rewritten buildToneGuidelinesSection() with epistemic principle
  - Diff-grounded dep-bump focus lists with epistemic reinforcement
  - Footnote citation format in security and changelog sections
  - Diff-grounded conventional commit type guidance
requires: []
affects: []
key_files: []
key_decisions:
  - "Three-tier knowledge classification: diff-visible, system-enrichment, external-knowledge"
  - "External knowledge silently omitted — no hedging, no acknowledgment"
  - "Universal citation rule: diff-visible cites file:line, enrichment cites footnote URL"
  - "General programming knowledge (null deref, SQL injection) explicitly allowed as exception"
  - "Blanket anti-hedging rule replaced with epistemic principle"
patterns_established:
  - "Epistemic boundary pattern: all prompt sections defer to epistemic rules for assertion grounding"
  - "Footnote citation format: [N] inline with [N]: URL collected at section end"
observability_surfaces: []
drill_down_paths: []
duration: 12min
verification_result: passed
completed_at: 2026-03-02
blocker_discovered: false
---
# S01: Pr Review Epistemic Guardrails

**# Phase 115-01: Epistemic Boundary Section Summary**

## What Happened

# Phase 115-01: Epistemic Boundary Section Summary

**Three-tier epistemic boundary rules in PR review prompt with diff-grounded dep-bump guidance, footnote citations, and rewritten tone/conventional-commit sections**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-02
- **Completed:** 2026-03-02
- **Tasks:** 2 (TDD — RED/GREEN per task)
- **Files modified:** 2

## Accomplishments
- New `buildEpistemicBoundarySection()` with three-tier knowledge classification (diff-visible, system-enrichment, external-knowledge), universal citation rules, hallucination denylist, and general programming knowledge exception
- Rewrote `buildToneGuidelinesSection()` to replace blanket "Do NOT use hedged language" with epistemic principle grounded in diff evidence
- Rewrote dep-bump focus lists (major and minor/patch) to be diff-grounded; added epistemic reinforcement and unenriched dep-bump fallback text
- Added footnote citation format to security advisory and changelog sections
- Rewrote conventional commit typeGuidance to be diff-grounded and BREAKING CHANGE text to reference diff-visible indicators

## Task Commits

Each task was committed atomically (TDD — RED then GREEN):

1. **Task 1: RED — Failing tests** - `ca207fec03` (test)
2. **Task 1+2: GREEN — Implementation** - `46ee3d4070` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - New buildEpistemicBoundarySection(), rewritten buildToneGuidelinesSection(), rewritten dep-bump focus lists, footnote citations in security/changelog, diff-grounded typeGuidance
- `src/execution/review-prompt.test.ts` - 25 new tests covering epistemic boundaries, tone rewrite, dep-bump changes, footnote citations, conventional commit rewrites; updated 3 existing tests

## Decisions Made
- Used DO/DON'T format consistent with existing prompt style for epistemic boundary section
- Footnote indices are per-section (security advisories get their own [1], [2], etc.; changelog gets separate [1])
- Stabilizing language grounded in observable diff evidence (test assertions unchanged, same function signatures)
- Epistemic rules placed before conventional commit context so they govern all downstream sections

## Deviations from Plan
None - plan executed as specified

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Epistemic boundary rules are in place for PR review surface
- Phase 116 (cross-surface epistemic guardrails) can propagate these rules to mention and Slack surfaces
- Phase 117 (claim classification) can build post-LLM classification on the foundation of clearly defined epistemic categories

---
*Phase: 115-pr-review-epistemic-guardrails*
*Completed: 2026-03-02*
