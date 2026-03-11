# T02: 73-degraded-retrieval-contract 02

**Slice:** S02 — **Milestone:** M013

## Description

Deliver RET-07 by guaranteeing bounded, well-formed retrieval evidence rendering across degraded review and mention surfaces.

Purpose: Phase 73 requires degraded paths to preserve retrieval usefulness without risking prompt overflow or malformed context sections.
Output: Tightened retrieval rendering contract and regression coverage for review + mention prompt builders, including degraded-path combinations.

## Must-Haves

- [ ] "Degraded retrieval output stays within configured prompt budgets and never overflows section limits"
- [ ] "When snippet anchors are unavailable, retrieval evidence degrades to deterministic path-only bullets instead of malformed output"
- [ ] "Review and mention prompts omit retrieval sections cleanly when nothing fits budget (no dangling headers or broken formatting)"
- [ ] "Degraded review paths still render well-formed retrieval context sections when retrieval context is present"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.test.ts`
