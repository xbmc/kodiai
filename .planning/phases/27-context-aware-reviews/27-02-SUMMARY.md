---
phase: 27-context-aware-reviews
plan: 02
subsystem: api
tags: [prompt-enrichment, picomatch, diff-analysis, review-handler]
requires:
  - phase: 27-01
    provides: review config extensions and deterministic diff-analysis module
provides:
  - Review prompt sections for change context and path-specific instructions
  - Path instruction matching with include/exclude glob semantics and cumulative results
  - Review handler wiring for diff analysis, profile resolution, and enriched prompt context
affects: [review-prompt, review-handler, context-aware-reviews]
tech-stack:
  added: []
  patterns: [deterministic prompt enrichment, profile defaults with explicit override precedence]
key-files:
  created: []
  modified: [src/execution/review-prompt.ts, src/execution/review-prompt.test.ts, src/handlers/review.ts]
key-decisions:
  - "Path instruction matching separates include/exclude patterns using picomatch scan semantics and applies cumulative config-order matches"
  - "Profile presets resolve in handler using schema-default heuristics so explicit non-default config values win"
patterns-established:
  - "Prompt enrichment sections are optional and injected only when data exists to preserve backward compatibility"
  - "Review handler performs deterministic analysis and context matching before LLM prompt construction"
duration: 5min
completed: 2026-02-12
---

# Phase 27 Plan 02: Context-Aware Reviews Summary

**Review prompts now include deterministic change context and path-scoped guidance, with handler-side profile resolution and diff analysis wired into the review pipeline.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-12T01:56:50Z
- **Completed:** 2026-02-12T02:01:45Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `matchPathInstructions`, `buildPathInstructionsSection`, and `buildDiffAnalysisSection` to enrich prompt content with bounded, deterministic context.
- Extended `buildReviewPrompt()` context with optional `diffAnalysis` and `matchedPathInstructions` while preserving backward-compatible behavior.
- Added 17+ focused tests covering path matching semantics, prompt section formatting/truncation, and optional integration paths.
- Wired review handler execution to run numstat/full diff analysis, path instruction matching, profile preset resolution, and enrichment logging before LLM execution.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add path instruction matching and prompt enrichment sections to review-prompt.ts** - `48a44926d9` (feat)
2. **Task 2: Wire diff analysis, path matching, and profile resolution in review handler** - `dea1878dbd` (feat)

## Files Created/Modified
- `src/execution/review-prompt.ts` - Added path-instruction matching + section builders and integrated optional enrichment sections in prompt assembly.
- `src/execution/review-prompt.test.ts` - Added comprehensive tests for matching behavior, truncation boundaries, diff context formatting, and backward compatibility.
- `src/handlers/review.ts` - Added deterministic diff-analysis execution, path instruction matching, profile preset resolution, enrichment logging, and updated prompt wiring.

## Decisions Made
- Kept profile preset resolution in handler (not schema) so prompt builder remains profile-agnostic and consumes only resolved review fields.
- Applied path instruction truncation with deterministic prioritization and a fixed section budget to keep prompt growth bounded.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Context-aware prompt pipeline is fully wired and validated; no additional schema or handler groundwork is required for downstream review quality tuning.
- Existing behavior remains unchanged when new context fields are absent, so rollout can proceed safely.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/27-context-aware-reviews/27-02-SUMMARY.md`.
- Verified task commits `48a44926d9` and `dea1878dbd` exist in git history.

---
*Phase: 27-context-aware-reviews*
*Completed: 2026-02-12*
