# T02: 29-feedback-capture 02

**Slice:** S04 — **Milestone:** M004

## Description

Implement LEARN-05 capture behavior by syncing thumbs reactions from Kodiai review comments into the knowledge store using the existing event/job pipeline.

Purpose: Reaction webhook events are not available in the current event model, so phase success requires an idempotent bounded sync strategy triggered from supported webhook traffic.

Output: Feedback sync handler, routing/wiring, and tests that capture thumbs reactions per-repo with deterministic finding correlation.

## Must-Haves

- [ ] "When users react with thumbs-up or thumbs-down on Kodiai review comments, those reactions are captured and linked to the originating finding"
- [ ] "Feedback capture is per-repo, idempotent, and bounded so retries/webhook churn do not duplicate rows or block webhook handling"
- [ ] "Captured feedback is stored for future analysis only and does not automatically change review behavior"

## Files

- `src/handlers/feedback-sync.ts`
- `src/handlers/feedback-sync.test.ts`
- `src/index.ts`
