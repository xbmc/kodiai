---
phase: 91-cross-corpus-retrieval-integration
plan: 04
status: complete
---

## Summary

Wired all retrieval consumers to use the unified cross-corpus pipeline with triggerType-based source boosting and citation formatting. Added comprehensive E2E tests.

## What Was Built

- **Consumer wiring**: All three handlers (review, mention, Slack) pass `triggerType` to retriever and forward `unifiedResults`/`contextWindow` to prompt builders
- **Prompt integration**: `buildReviewPrompt` accepts `unifiedResults` and `contextWindow`, preferring `formatUnifiedContext` over legacy separate sections when available, with fallback for backward compat
- **E2E test suite**: 6 new cross-corpus tests proving attribution from all three corpora, triggerType boosting, fail-open resilience, and legacy field preservation
- **Citation formatting**: `formatUnifiedContext` produces inline source labels with clickable links, alternate source annotations, and soft cap at 8 citations

## Key Decisions

- Unified context section replaces all three legacy sections (retrieval, precedents, wiki) when present, avoiding duplicate context
- Legacy path preserved in `buildReviewPrompt` for deployments where unified pipeline is not yet active
- E2E tests use bun:test (same as existing retrieval tests) with mock stores providing known data from all three corpora

## Key Files

### Modified
- `src/handlers/review.ts` — Passes triggerType: "pr_review" and unified results to prompt builder
- `src/handlers/mention.ts` — Passes triggerType: "question" to retriever
- `src/slack/assistant-handler.ts` — Passes triggerType: "slack", prefers contextWindow
- `src/execution/review-prompt.ts` — Added unifiedResults/contextWindow to buildReviewPrompt, integrated formatUnifiedContext
- `src/knowledge/retrieval.e2e.test.ts` — 6 new cross-corpus E2E tests (10 total)

## Self-Check: PASSED

- [x] All 22 bun retrieval tests pass (12 unit + 10 E2E)
- [x] All 32 vitest knowledge tests pass
- [x] All 124 review-prompt tests pass
- [x] No new type errors in modified files
- [x] E2E proves: single call returns code + review + wiki with attribution
- [x] All handlers pass triggerType for context-dependent weighting
- [x] Legacy fields preserved for backward compatibility
