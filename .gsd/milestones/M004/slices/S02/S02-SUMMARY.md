---
id: S02
parent: M004
milestone: M004
provides:
  - Review prompt sections for change context and path-specific instructions
  - Path instruction matching with include/exclude glob semantics and cumulative results
  - Review handler wiring for diff analysis, profile resolution, and enriched prompt context
  - Extended review schema with path instructions, profile presets, and file category overrides
  - Deterministic diff analysis module with risk signals and metrics
  - Focused test coverage for schema fallback and diff-analysis boundaries
  - Resilient review diff collection that recovers or gracefully falls back when merge-base is unavailable
  - Structured logging for diff strategy outcomes during review execution
  - Regression coverage for no-merge-base flows and backward compatibility without Phase 27 fields
  - Elapsed-time budget enforcement for deterministic diff category and risk scanning
  - Graceful time-budget truncation signaling without breaking analysis output shape
  - Regression tests for within-budget and exceeded-budget analyzer paths
requires: []
affects: []
key_files: []
key_decisions:
  - "Path instruction matching separates include/exclude patterns using picomatch scan semantics and applies cumulative config-order matches"
  - "Profile presets resolve in handler using schema-default heuristics so explicit non-default config values win"
  - "Path instruction config uses array entries with string|string[] paths and defaults to empty list"
  - "Diff analysis categorizes only first 200 files but always computes metrics across all changed files"
  - "Use adaptive deepen plus unshallow attempts before switching from triple-dot to two-dot diff"
  - "Collect changed files, numstat, and full diff from one resolved diff range so prompt context stays aligned"
  - "Emit time-budget degradation as a stable risk signal string to preserve existing DiffAnalysis shape"
  - "Compute metrics from full changed-file and numstat inputs even when scanning truncates due to elapsed-time budget"
patterns_established:
  - "Prompt enrichment sections are optional and injected only when data exists to preserve backward compatibility"
  - "Review handler performs deterministic analysis and context matching before LLM prompt construction"
  - "Pure analysis modules receive git outputs as inputs and perform no shell I/O"
  - "Review schema additions remain additive with section-level fallback preserving resilience"
  - "Diff collection logs strategy metadata under gate=diff-collection for operational diagnosis"
  - "No-merge-base review regressions are validated by behavior-based handler tests, not git stderr string matching"
  - "Elapsed-time enforcement is additive to file/content caps and applied before and during scalable loop work"
  - "Time-budget regressions are tested deterministically by mocking Date.now sequences"
observability_surfaces: []
drill_down_paths: []
duration: 2 min
verification_result: passed
completed_at: 2026-02-12
blocker_discovered: false
---
# S02: Context Aware Reviews

**# Phase 27 Plan 02: Context-Aware Reviews Summary**

## What Happened

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

# Phase 27 Plan 01: Context-Aware Reviews Summary

**Review config now supports path-scoped instruction and profile metadata, plus a deterministic diff analyzer that emits category/risk/metric context for prompt enrichment.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T01:52:56Z
- **Completed:** 2026-02-12T01:55:27Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended `reviewSchema` with `pathInstructions`, `profile`, and `fileCategories` while preserving additive defaults and section fallback behavior.
- Added config tests that validate parsing, optional/default behavior, invalid-section fallback, and coexistence with Phase 26 fields.
- Introduced `analyzeDiff()` in a new pure module with capped classification, risk signal detection, numstat metrics, and large-PR detection.
- Added 15 targeted diff-analysis tests for categories, overrides, risk signals, hunk counting, content limits, and analysis caps.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pathInstructions, profile, and fileCategories to config schema** - `710813888c` (feat)
2. **Task 2: Create deterministic diff analysis module** - `9675b9e938` (feat)

## Files Created/Modified
- `src/execution/config.ts` - Added new review schema fields and defaults for path instructions.
- `src/execution/config.test.ts` - Added coverage for new schema parsing, optionality, fallback, and compatibility.
- `src/execution/diff-analysis.ts` - Added pure diff analyzer with categorization, risk signal checks, and metrics.
- `src/execution/diff-analysis.test.ts` - Added comprehensive tests for deterministic diff analysis behavior.

## Decisions Made
- Kept `fileCategories` override behavior additive to default category patterns so existing classification remains stable.
- Implemented fixed performance boundaries (`MAX_ANALYSIS_FILES = 200`, content scan < 50KB) and separated classification scope from global metrics scope.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can now import `analyzeDiff()` and consume stable `review.pathInstructions`/`review.profile`/`review.fileCategories` config inputs.
- Prompt and handler wiring can proceed without additional schema or analysis groundwork.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/27-context-aware-reviews/27-01-SUMMARY.md`.
- Verified task commits `710813888c` and `9675b9e938` exist in git history.

---
*Phase: 27-context-aware-reviews*
*Completed: 2026-02-12*

# Phase 27 Plan 03: Context-Aware Reviews Summary

**Review execution now survives no-merge-base shallow ancestry by recovering base history when possible and falling back to deterministic two-dot diff collection without skipping path-aware prompt enrichment.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-12T03:27:30Z
- **Completed:** 2026-02-12T03:27:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added a resilient diff collection helper in the review handler that checks merge-base, deepens fetch history, attempts unshallow recovery, and falls back safely.
- Unified `--name-only`, `--numstat`, and full diff extraction under one chosen range to keep changed-file matching and diff analysis in sync.
- Added structured logs for diff strategy, attempts, and merge-base recovery outcomes.
- Added regression tests proving no-merge-base flows still execute review prompt generation and that path instructions continue to apply.
- Added backward-compatibility coverage for repos that omit Phase 27 review config fields.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden review diff collection for shallow clone merge-base gaps** - `fb980b2191` (feat)
2. **Task 2: Add regression tests for no-merge-base shallow ancestry flow** - `5a0794eafb` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Added adaptive merge-base recovery and deterministic fallback diff strategy with structured logging.
- `src/handlers/review.test.ts` - Added no-merge-base continuation and backward-compat regression tests.

## Decisions Made
- Prioritized continuity of review execution over hard failure when merge-base is unavailable by using bounded recovery attempts plus deterministic fallback.
- Kept fallback behavior deterministic and observable by logging the strategy and retry metadata under a stable log gate key.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 27 UAT blocker is addressed in code and tests; live review can proceed without early exit-128 failures on no-merge-base topology.
- Phase 28 can build on stable review execution and context enrichment flow without additional diff-handling changes.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/27-context-aware-reviews/27-03-SUMMARY.md`.
- Verified task commits `fb980b2191` and `5a0794eafb` exist in git history.

# Phase 27 Plan 04: Context-Aware Reviews Summary

**Deterministic diff analysis now enforces an explicit elapsed-time budget and emits a stable truncation signal while preserving downstream metrics and output contracts.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-12T03:58:17Z
- **Completed:** 2026-02-12T04:00:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `MAX_ANALYSIS_TIME_MS` guardrails to `analyzeDiff` and enforced elapsed-time checks before and during category/risk scanning loops.
- Added graceful degradation behavior that stops additional scanning when time budget is exceeded and returns a deterministic truncation signal.
- Preserved deterministic metrics shape (`totalFiles`, line totals, hunk count) regardless of truncation state.
- Added deterministic regression tests for both within-budget and exceeded-budget paths using mocked `Date.now` sequences.
- Re-ran required verification commands and confirmed the previously failed elapsed-time truth is now implemented and covered.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add elapsed-time budget enforcement and graceful truncation in diff analysis** - `17fdc7c6c1` (feat)
2. **Task 2: Add regression coverage for time-budget exceeded and within-budget paths** - `491e0523ed` (test)

## Files Created/Modified
- `src/execution/diff-analysis.ts` - Added elapsed-time budget constant, loop guard checks, and deterministic truncation signaling.
- `src/execution/diff-analysis.test.ts` - Added stable clock-mocked regression tests for within-budget and exceeded-budget behavior.

## Decisions Made
- Represented elapsed-time degradation with a fixed risk signal message rather than adding new response fields, keeping prompt-enrichment compatibility.
- Kept metrics computation independent from scanning truncation so downstream consumers always receive a stable metrics structure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced unavailable `rg` with `grep` during self-check commit verification**
- **Found during:** Self-check
- **Issue:** Local shell environment does not have `rg` installed, which caused false missing-commit results.
- **Fix:** Re-ran commit-existence checks with `grep -q` against `git log --oneline --all`.
- **Files modified:** None
- **Verification:** Commit hashes `17fdc7c6c1` and `491e0523ed` confirmed present after fallback command.
- **Committed in:** N/A (verification command adjustment only)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change; deviation only affected verification command portability.

## Authentication Gates

None.

## Issues Encountered

- `rg` was unavailable in the execution environment; resolved by switching self-check commit lookups to `grep`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 27 verification gap on elapsed-time budget enforcement is closed in implementation and tests.
- Context-aware prompt enrichment can rely on bounded deterministic diff analysis behavior for larger or expensive PRs.

## Self-Check: PASSED

- Verified `.planning/phases/27-context-aware-reviews/27-04-SUMMARY.md` exists.
- Verified `src/execution/diff-analysis.ts` and `src/execution/diff-analysis.test.ts` exist.
- Verified task commits `17fdc7c6c1` and `491e0523ed` exist in git history.
