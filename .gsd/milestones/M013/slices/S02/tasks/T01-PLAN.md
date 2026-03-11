# T01: 73-degraded-retrieval-contract 01

**Slice:** S02 — **Milestone:** M013

## Description

Lock RET-06 as a runtime contract by making partial-analysis disclosure deterministic in user-visible degraded review outputs.

Purpose: Prompt-only instructions are not sufficient for reliability follow-through because model wording can drift; Phase 73 requires the exact sentence to appear on every degraded path.
Output: Review-handler disclosure enforcement plus tests proving exact-sentence presence on degraded executions and no leakage on non-degraded executions.

## Must-Haves

- [ ] "Every Search-rate-limited degraded review path publishes user-visible output that contains the exact sentence 'Analysis is partial due to API limits.'"
- [ ] "Disclosure text is deterministic on degraded runs even when model output omits or rewrites it"
- [ ] "Non-degraded review outputs do not gain false partial-analysis disclosure"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
