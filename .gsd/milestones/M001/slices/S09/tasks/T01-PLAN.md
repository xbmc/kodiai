# T01: 10-review-request-reliability 01

**Slice:** S09 — **Milestone:** M001

## Description

Debug and harden production handling of `pull_request.review_requested` so manually re-requesting kodiai always triggers review. Validate the complete path: webhook delivery, router dispatch, trigger gating, and execution enqueue/run lifecycle.

## Must-Haves

- [ ] "Every pull_request.review_requested webhook can be traced end-to-end by delivery ID"
- [ ] "Router dispatch decisions are observable (matched handler keys, filtered vs dispatched)"
- [ ] "Trigger gating clearly reports why review_requested ran or was skipped"
- [ ] "Manual re-request of kodiai reliably enqueues and executes exactly one review job"

## Files

- `src/routes/webhooks.ts`
- `src/webhook/router.ts`
- `src/handlers/review.ts`
- `src/jobs/queue.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.test.ts`
- `docs/runbooks/review-requested-debug.md`
