---
id: T02
parent: S03
milestone: M040
key_files:
  - src/review-graph/validation.ts
  - src/review-graph/validation.test.ts
  - src/handlers/review.ts
key_decisions:
  - isTrivialChange() defaults to file-count threshold of 3; line threshold is opt-in (default 0 = disabled)
  - Trivial bypass fail-closed: returns false (run graph) for changedFileCount=0 or unexpected inputs
  - Validation gate uses GUARDRAIL_CLASSIFICATION task type (Haiku-class) to match existing non-agentic usage pattern
  - Dynamic imports inside gate block to avoid circular dependencies
  - graphValidated/graphValidationVerdict metadata attached to processedFindings without modifying suppressed/confidence
  - graphValidation.enabled config accessed via type assertion — schema addition deferred to T03
duration: 
verification_result: passed
completed_at: 2026-04-05T12:25:40.562Z
blocker_discovered: false
---

# T02: Add isTrivialChange() bypass and validateGraphAmplifiedFindings() gate; wire both into review handler fail-open; 24 new tests pass, 235 total pass, tsc clean

**Add isTrivialChange() bypass and validateGraphAmplifiedFindings() gate; wire both into review handler fail-open; 24 new tests pass, 235 total pass, tsc clean**

## What Happened

Created src/review-graph/validation.ts with isTrivialChange() (file-count-based trivial bypass, fail-closed, configurable) and validateGraphAmplifiedFindings() (optional second-pass LLM validation for findings on graph-amplified files, fail-open, annotates findings with graphValidated and graphValidationVerdict without suppressing anything). Wrote 24 tests covering all trivial bypass thresholds, active validation with confirming/uncertain LLMs, fail-open paths (LLM throw, unparseable response), and edge cases (empty findings, mixed changed/amplified files). Wired into the handler: added import, trivial bypass check before graph query, blast radius result capture, graphBlastRadius threaded to buildReviewPrompt(), and optional validation gate after guardrail pipeline. Validation gate is guarded by config.review.graphValidation?.enabled (default false, inert) and uses a dynamic import of the GUARDRAIL_CLASSIFICATION task router to stay fail-open.

## Verification

bun test ./src/review-graph/validation.test.ts — 24 pass, 0 fail in 14ms. bun test ./src/review-graph/ ./src/execution/review-prompt.test.ts — 235 pass, 7 skip (DB), 0 fail in 75ms. bun run tsc --noEmit — no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-graph/validation.test.ts` | 0 | ✅ pass | 14ms |
| 2 | `bun test ./src/review-graph/ ./src/execution/review-prompt.test.ts` | 0 | ✅ pass | 75ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 6700ms |

## Deviations

config.review.graphValidation schema not added to Zod config — accessed via type assertion to keep gate inert by default without schema migration. T03 can formalize when ready to promote.

## Known Issues

None.

## Files Created/Modified

- `src/review-graph/validation.ts`
- `src/review-graph/validation.test.ts`
- `src/handlers/review.ts`
