# S09: Review Request Reliability

**Goal:** Debug and harden production handling of `pull_request.
**Demo:** Debug and harden production handling of `pull_request.

## Must-Haves


## Tasks

- [x] **T01: 10-review-request-reliability 01** `est:34 min`
  - Debug and harden production handling of `pull_request.review_requested` so manually re-requesting kodiai always triggers review. Validate the complete path: webhook delivery, router dispatch, trigger gating, and execution enqueue/run lifecycle.
- [x] **T02: 10-review-request-reliability 02** `est:10 min`
  - Ship the already-implemented review-request reliability hardening by committing current uncommitted changes, deploying the update to Azure Container Apps using `./deploy.sh`, and proving manual `pull_request.review_requested` behavior on `kodiai/xbmc` PR #8 with delivery-to-log correlation evidence.

Purpose: Convert completed hardening work into a deployed, verified production state with reproducible forensic evidence.
Output: One reliability-hardening commit on `test/phase9-ux-features`, one successful ACA rollout, and a summary containing commit/deployment/validation evidence.
- [x] **T03: 10-review-request-reliability 03** `est:3 min`
  - Close the primary reliability gap by adding deterministic downstream idempotency for review output publication, so one manual `pull_request.review_requested` delivery cannot fan out into multiple review batches.

Purpose: Enforce exactly-once output semantics even if ingress dedup is bypassed or retries/restarts re-enter the review path.
Output: Idempotency-keyed review publication guard wired through review handler and MCP output path.
- [x] **T04: 10-review-request-reliability 04** `est:2 min`
  - Close the remaining verification gaps by adding explicit automated regression coverage for exactly-once review output and retry/duplicate idempotency behavior.

Purpose: Make reliability claims enforceable in CI so regressions are caught before deployment.
Output: New idempotency-focused tests and reproducible verification evidence.

## Files Likely Touched

- `src/routes/webhooks.ts`
- `src/webhook/router.ts`
- `src/handlers/review.ts`
- `src/jobs/queue.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.test.ts`
- `docs/runbooks/review-requested-debug.md`
- `src/routes/webhooks.ts`
- `src/webhook/router.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/jobs/queue.ts`
- `src/jobs/types.ts`
- `src/execution/config.test.ts`
- `docs/runbooks/review-requested-debug.md`
- `.planning/phases/10-review-request-reliability/10-02-SUMMARY.md`
- `src/handlers/review.ts`
- `src/handlers/review-idempotency.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mcp/inline-review-server.ts`
- `src/handlers/review.test.ts`
- `src/execution/mcp/inline-review-server.test.ts`
- `src/handlers/review-idempotency.test.ts`
- `.planning/phases/10-review-request-reliability/10-04-SUMMARY.md`
