# S04: Feedback Capture

**Goal:** Add the storage and correlation foundation for LEARN-05 so reaction feedback can be tied back to exact Kodiai findings deterministically.
**Demo:** Add the storage and correlation foundation for LEARN-05 so reaction feedback can be tied back to exact Kodiai findings deterministically.

## Must-Haves


## Tasks

- [x] **T01: 29-feedback-capture 01** `est:3 min`
  - Add the storage and correlation foundation for LEARN-05 so reaction feedback can be tied back to exact Kodiai findings deterministically.

Purpose: Phase 29 needs durable finding-to-comment linkage and append-only feedback storage before any sync job can capture thumbs reactions reliably.

Output: Knowledge store schema/types and review persistence wiring updated to support deterministic correlation and idempotent feedback writes.
- [x] **T02: 29-feedback-capture 02** `est:3 min`
  - Implement LEARN-05 capture behavior by syncing thumbs reactions from Kodiai review comments into the knowledge store using the existing event/job pipeline.

Purpose: Reaction webhook events are not available in the current event model, so phase success requires an idempotent bounded sync strategy triggered from supported webhook traffic.

Output: Feedback sync handler, routing/wiring, and tests that capture thumbs reactions per-repo with deterministic finding correlation.

## Files Likely Touched

- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/feedback-sync.ts`
- `src/handlers/feedback-sync.test.ts`
- `src/index.ts`
