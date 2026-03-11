---
id: S04
parent: M012
milestone: M012
provides:
  - Fail-open snippet anchor extraction utility with path:line evidence when matching lines are found
  - Deterministic prompt-budget trimming utility with max item and max char enforcement
  - RED->GREEN regression tests for anchor extraction, fallback behavior, and deterministic trimming
  - Review and mention handlers now enrich retrieval findings with path/line/snippet anchor evidence
  - Review and mention prompt builders now enforce strict retrieval section budgets with deterministic overflow trimming
  - Fail-open retrieval rendering now degrades to path-only evidence when snippet extraction is unavailable
requires: []
affects: []
key_files: []
key_decisions:
  - "Snippet extraction is fail-open per finding: any read/match failure degrades to path-only anchor output without throwing."
  - "Budget trimming keeps the most relevant anchors (lowest distance first) and removes overflow from the tail with deterministic path/line tie-breakers."
  - "Review retrieval budgets are enforced at prompt-render time using `knowledge.retrieval.maxContextChars`, so section omission is deterministic when nothing fits."
  - "Mention retrieval context remains topK-bounded (<=3) and additionally applies a fixed 1200-char cap for predictable prompt size on conversational surfaces."
patterns_established:
  - "Snippet anchor contract: `{ path, line?, anchor, snippet?, distance }` supports evidence-rich and path-only fallback rendering."
  - "Prompt-budget guardrail: enforce both maxItems and maxChars before prompt assembly to prevent context bloat."
  - "Handler enrichment pattern: compute snippet anchors once, then pass path/line/snippet evidence into prompt-facing retrieval context."
  - "Rendering pattern: evidence bullets prefer `path:line` + snippet and fall back to `path` + finding text without failing prompt construction."
observability_surfaces: []
drill_down_paths: []
duration: 13m
verification_result: passed
completed_at: 2026-02-17
blocker_discovered: false
---
# S04: Snippet Anchors Prompt Budgeting

**# Phase 69 Plan 01: Retrieval snippet anchor utilities Summary**

## What Happened

# Phase 69 Plan 01: Retrieval snippet anchor utilities Summary

**RET-08 now has reusable snippet-anchor extraction and deterministic budget trimming so retrieval context can provide concise `path:line` evidence without exceeding prompt limits.**

## Performance

- **Duration:** 2m
- **Started:** 2026-02-17T01:20:37Z
- **Completed:** 2026-02-17T01:22:43Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `buildSnippetAnchors` with normalized token matching, bounded single-line snippets, and per-finding fail-open path-only fallback.
- Added `trimSnippetAnchorsToBudget` with strict max-item and max-char enforcement.
- Added RED->GREEN tests locking anchor formatting, deterministic ordering, and fallback behavior for unreadable files.

## Task Commits

Each task was committed atomically:

1. **Task 1: Retrieval snippet anchors + budget trimming (RED)** - `2fc9118e10` (test)
2. **Task 1: Retrieval snippet anchors + budget trimming (GREEN)** - `68e3647163` (feat)

## Files Created/Modified
- `src/learning/retrieval-snippets.ts` - Snippet-anchor extraction and deterministic budget trimming utilities.
- `src/learning/retrieval-snippets.test.ts` - TDD regression suite for extraction, fallback, and budget behavior.

## Decisions Made
- Reused retrieval finding distance as the relevance score for trimming so prompt budget decisions align with retrieval ranking semantics.
- Required at least two token hits (or one phrase hit) before assigning a line anchor to avoid weak accidental matches.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RET-08 utility primitives are integration-ready for prompt wiring in Plan 69-02.
- No blockers identified.

---
*Phase: 69-snippet-anchors-prompt-budgeting*
*Completed: 2026-02-17*

## Self-Check: PASSED

- FOUND: `.planning/phases/69-snippet-anchors-prompt-budgeting/69-01-SUMMARY.md`
- FOUND: `2fc9118e10`
- FOUND: `68e3647163`

# Phase 69 Plan 02: Snippet-anchor prompt integration Summary

**Review and mention production paths now render retrieval evidence as actionable anchor snippets with strict budget guards and deterministic path-only fail-open fallback.**

## Performance

- **Duration:** 13m
- **Started:** 2026-02-17T01:24:10Z
- **Completed:** 2026-02-17T01:37:45Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Integrated RET-08 snippet-anchor extraction into review and mention retrieval pipelines so prompt context now carries `path`, optional `line`, and optional `snippet` evidence.
- Updated retrieval prompt rendering to anchor-first evidence format with deterministic distance-based overflow trimming and path-only fallback.
- Added regressions across handlers and prompt builders for anchor evidence, budget trimming order, fallback formatting, and empty-section behavior when nothing fits.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enrich review and mention retrieval context with snippet anchors** - `97a54950bf` (feat)
2. **Task 2: Enforce strict retrieval prompt budgets with overflow trimming** - `24cc455df5` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Builds snippet anchors for reranked review retrieval findings and forwards anchor metadata into prompt context.
- `src/handlers/review.test.ts` - Adds handler-level regression for anchored evidence plus path-only fallback continuity.
- `src/handlers/mention.ts` - Enriches mention retrieval findings with snippet anchors, fail-open fallback, and bounded context trimming.
- `src/handlers/mention.test.ts` - Updates retrieval-context regressions for new anchor-aware prompt evidence expectations.
- `src/execution/review-prompt.ts` - Renders retrieval evidence with `path:line` snippets or path-only fallback and enforces strict section char budgets.
- `src/execution/review-prompt.test.ts` - Adds regressions for anchor formatting, budget overflow order, fallback formatting, and section omission.
- `src/execution/mention-prompt.ts` - Adds anchor-aware retrieval rendering with bounded item/char limits and deterministic overflow trimming.
- `src/execution/mention-prompt.test.ts` - Adds regressions for mention retrieval anchor formatting, fallback behavior, overflow trimming, and empty-budget omission.

## Decisions Made
- Applied retrieval budget enforcement in prompt builders (not only handler assembly) so final rendered sections always respect per-surface constraints.
- Kept mention retrieval cap explicit (`1200` chars) while preserving existing topK guardrail (`<=3`) to avoid response bloat in conversational threads.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Mention retrieval orchestration tests required non-write-intent phrasing and adjusted assertions to keep coverage focused on retrieval evidence formatting instead of issue write-intent gating.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 69 retrieval snippet-anchor integration is complete across both review and mention surfaces.
- No blockers identified.

---
*Phase: 69-snippet-anchors-prompt-budgeting*
*Completed: 2026-02-17*

## Self-Check: PASSED

- FOUND: `.planning/phases/69-snippet-anchors-prompt-budgeting/69-02-SUMMARY.md`
- FOUND: `97a54950bf`
- FOUND: `24cc455df5`
