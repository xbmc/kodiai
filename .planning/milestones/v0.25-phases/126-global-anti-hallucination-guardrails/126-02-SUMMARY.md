---
phase: 126-global-anti-hallucination-guardrails
plan: 02
subsystem: guardrail
tags: [anti-hallucination, llm-classifier, haiku, review-adapter, surface-adapter]

requires:
  - phase: 126-01
    provides: SurfaceAdapter, GroundingContext, GuardrailConfig, runGuardrailPipeline, context-classifier, allowlist
provides:
  - PR review surface adapter wrapping existing classifier + filter
  - LLM fallback classifier for ambiguous claims via batched Haiku calls
  - Pipeline integration with batched LLM fallback
affects: [126-03-surface-adapters, 126-04-integration, pr-review]

tech-stack:
  added: []
  patterns: [batched-llm-classification, review-adapter-wraps-existing, fail-open-llm-fallback]

key-files:
  created:
    - src/lib/guardrail/adapters/review-adapter.ts
    - src/lib/guardrail/adapters/review-adapter.test.ts
    - src/lib/guardrail/llm-classifier.ts
    - src/lib/guardrail/llm-classifier.test.ts
  modified:
    - src/lib/guardrail/pipeline.ts
    - src/lib/guardrail/pipeline.test.ts
    - src/llm/task-types.ts

key-decisions:
  - "Review adapter wraps existing claim-classifier.ts and output-filter.ts rather than reimplementing -- zero behavior change"
  - "LLM classifier batches up to 10 claims per Haiku call to minimize overhead"
  - "Pipeline collects all ambiguous claims first, then makes single batched LLM call instead of per-claim calls"
  - "GUARDRAIL_CLASSIFICATION task type resolves to Haiku via default non-agentic routing"

patterns-established:
  - "Review adapter pattern: SurfaceAdapter wrapping existing classification+filtering for backward compat"
  - "Batched LLM fallback: collect ambiguous claims, batch into chunks of 10, single call per batch"
  - "LLM response parsing: handle JSON with markdown fences, pad mismatched lengths with fail-open defaults"

requirements-completed: [GUARD-04, GUARD-05]

duration: 4min
completed: 2026-03-07
---

# Phase 126 Plan 02: Review Adapter & LLM Fallback Summary

**PR review surface adapter wrapping existing classifier+filter with batched Haiku LLM fallback for ambiguous claims**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T09:13:06Z
- **Completed:** 2026-03-07T09:17:02Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Review adapter wraps existing claim-classifier.ts and output-filter.ts with zero behavior change
- LLM fallback classifier uses batched Haiku calls (max 10 claims per batch) for ambiguous claims
- Pipeline updated from per-claim LLM calls to batched approach for efficiency
- GUARDRAIL_CLASSIFICATION task type added to task-types.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create review adapter wrapping existing classifier + filter** - `be7fc69cf7` (feat)
2. **Task 2: Create LLM fallback classifier and wire into pipeline** - `8da0edf0b4` (feat)

_Note: TDD tasks have RED+GREEN in single commits (tests + implementation together)_

## Files Created/Modified
- `src/lib/guardrail/adapters/review-adapter.ts` - PR review surface adapter with extractClaims, buildGroundingContext, reconstructOutput
- `src/lib/guardrail/adapters/review-adapter.test.ts` - 8 tests covering adapter behavior
- `src/lib/guardrail/llm-classifier.ts` - Batched Haiku LLM classifier with fail-open behavior
- `src/lib/guardrail/llm-classifier.test.ts` - 6 tests covering batching, parsing, fail-open
- `src/lib/guardrail/pipeline.ts` - Updated to use batched LlmClassifier type
- `src/lib/guardrail/pipeline.test.ts` - 3 new tests for LLM integration in pipeline
- `src/llm/task-types.ts` - Added GUARDRAIL_CLASSIFICATION task type

## Decisions Made
- Review adapter wraps existing claim-classifier.ts and output-filter.ts rather than reimplementing -- zero behavior change
- LLM classifier batches up to 10 claims per Haiku call to minimize overhead
- Pipeline collects all ambiguous claims first, then makes single batched LLM call instead of per-claim calls
- GUARDRAIL_CLASSIFICATION task type resolves to Haiku via default non-agentic routing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Review adapter ready for integration into review.ts (plan 04)
- LLM classifier ready for use by any surface adapter
- Pipeline fully supports optional LLM fallback with batched classification

---
*Phase: 126-global-anti-hallucination-guardrails*
*Completed: 2026-03-07*
