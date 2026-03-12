---
id: T04
parent: S02
milestone: M026
provides:
  - Pure helper functions extracted from review.ts and mention.ts into dedicated lib modules
key_files:
  - src/lib/review-utils.ts
  - src/lib/mention-utils.ts
  - src/handlers/review.ts
  - src/handlers/mention.ts
key_decisions:
  - "Extracted 19 pure functions + 4 type aliases + 4 constants from review.ts into review-utils.ts"
  - "Extracted 2 pure functions from mention.ts into mention-utils.ts"
  - "Updated 4 downstream import sites (mention.test.ts, workspace.test.ts, slack/write-runner.ts, mention.ts)"
patterns_established:
  - "Pure helper extraction: move functions with no closure over handler state to src/lib/*-utils.ts"
observability_surfaces:
  - none
duration: ~10min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T04: Extract pure helpers from review.ts and mention.ts

**Extracted 21 pure functions, 4 type aliases, and 4 constants from review.ts and mention.ts into `src/lib/review-utils.ts` and `src/lib/mention-utils.ts`.**

## What Happened

Scanned `review.ts` (4,416 lines) and `mention.ts` (2,677 lines) for functions that take explicit parameters and don't close over handler state. Identified and moved:

**review-utils.ts (451 lines):** 19 pure functions — `ensureSearchRateLimitDisclosureInSummary`, `extractSearchErrorStatus`, `extractSearchErrorText`, `isSearchRateLimitError`, `resolveRateLimitBackoffMs`, `toConfidenceBand`, `fingerprintFindingTitle`, `buildReviewDetailsMarker`, `parseSeverityCountsFromBody`, `formatReviewDetailsSummary`, `normalizeSeverity`, `normalizeCategory`, `parseInlineCommentMetadata`, `normalizeSkipPattern`, `renderApprovalConfidence`, `splitGitLines`, `isReviewTriggerEnabled`, `normalizeReviewerLogin`, `splitDiffByFile`. Plus types (`ReviewArea`, `FindingSeverity`, `FindingCategory`, `ConfidenceBand`), constants (`SEARCH_RATE_LIMIT_ERROR_MARKERS`, `SEARCH_RATE_LIMIT_BACKOFF_MAX_MS`, `SEARCH_RATE_LIMIT_DISCLOSURE_LINE`, `PROFILE_PRESETS`).

**mention-utils.ts (106 lines):** 2 pure functions — `buildWritePolicyRefusalMessage`, `scanLinesForFabricatedContent`.

Updated all downstream imports: `src/slack/write-runner.ts`, `src/handlers/mention.test.ts`, `src/jobs/workspace.test.ts`.

## Verification

- `bunx tsc --noEmit` → 0 errors
- `bun test` → 2181 pass, 45 skip, 0 fail
- `wc -l src/handlers/review.ts` → 4030 (was 4416, −386 lines)
- `wc -l src/handlers/mention.ts` → 2587 (was 2677, −90 lines)
- `test -f src/lib/review-utils.ts` → exists
- `test -f src/lib/mention-utils.ts` → exists
- Slice-level checks: tsc clean, tests pass, console.log counts at 0 for all 7 target files

## Diagnostics

None — pure module-level refactoring with no runtime behavior change.

## Deviations

- Also extracted `PROFILE_PRESETS` constant (pure data) and 4 type aliases since extracted functions depend on them.
- Updated `src/slack/write-runner.ts` import path (was importing `buildWritePolicyRefusalMessage` from `handlers/mention.ts`).

## Known Issues

None.

## Files Created/Modified

- `src/lib/review-utils.ts` — new file with 19 extracted pure functions, types, and constants from review.ts
- `src/lib/mention-utils.ts` — new file with 2 extracted pure functions from mention.ts
- `src/handlers/review.ts` — replaced inline definitions with imports from review-utils.ts (−386 lines)
- `src/handlers/mention.ts` — replaced inline definitions with imports from mention-utils.ts (−90 lines)
- `src/slack/write-runner.ts` — updated import path for buildWritePolicyRefusalMessage
- `src/handlers/mention.test.ts` — updated import for scanLinesForFabricatedContent
- `src/jobs/workspace.test.ts` — updated import for buildWritePolicyRefusalMessage
