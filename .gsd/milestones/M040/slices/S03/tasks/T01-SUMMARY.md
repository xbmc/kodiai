---
id: T01
parent: S03
milestone: M040
key_files:
  - src/review-graph/prompt-context.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
key_decisions:
  - Graph section placed between incremental-review context and knowledge-retrieval context
  - Hard item caps (20/10/10) applied before char budget loop for O(cap × max_line_len) worst-case sizing
  - GraphContextSection return type carries stats for downstream observability
  - packSubSection() helper encapsulates the bounded-list packing pattern
duration: 
verification_result: passed
completed_at: 2026-04-05T12:15:00.879Z
blocker_discovered: false
---

# T01: Add buildGraphContextSection() for bounded graph prompt packing and wire it into buildReviewPrompt() via graphBlastRadius param; 203 tests pass

**Add buildGraphContextSection() for bounded graph prompt packing and wire it into buildReviewPrompt() via graphBlastRadius param; 203 tests pass**

## What Happened

Created src/review-graph/prompt-context.ts with buildGraphContextSection() that converts a ReviewGraphBlastRadiusResult into a bounded, rank-ordered Markdown prompt section (impacted files, likely tests, probable dependents). Section is capped by item count (default 10/5/5, hard caps 20/10/10) and char budget (default 2500) with a reserved truncation note. Returns empty when blast radius is null/empty for fail-open backward compatibility. Updated src/execution/review-prompt.ts to import the new function and accept graphBlastRadius + graphContextOptions params, injecting the section between incremental-review context and knowledge-retrieval context. Added 35 new tests covering all packing invariants, confidence labels, truncation behavior, and prompt integration.

## Verification

bun test ./src/execution/review-prompt.test.ts — 203 pass, 0 fail in 36ms. bun run tsc --noEmit — no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/review-prompt.test.ts` | 0 | ✅ pass | 36ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 800ms |

## Deviations

None.

## Known Issues

The handler (src/handlers/review.ts) already has the blast radius result but does not yet pass graphBlastRadius to buildReviewPrompt — that wiring is T02's responsibility.

## Files Created/Modified

- `src/review-graph/prompt-context.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
