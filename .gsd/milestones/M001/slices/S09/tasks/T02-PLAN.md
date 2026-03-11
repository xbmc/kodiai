# T02: 10-review-request-reliability 02

**Slice:** S09 — **Milestone:** M001

## Description

Ship the already-implemented review-request reliability hardening by committing current uncommitted changes, deploying the update to Azure Container Apps using `./deploy.sh`, and proving manual `pull_request.review_requested` behavior on `kodiai/xbmc` PR #8 with delivery-to-log correlation evidence.

Purpose: Convert completed hardening work into a deployed, verified production state with reproducible forensic evidence.
Output: One reliability-hardening commit on `test/phase9-ux-features`, one successful ACA rollout, and a summary containing commit/deployment/validation evidence.

## Must-Haves

- [ ] "A manual re-request of kodiai on kodiai/xbmc PR #8 produces exactly one review execution"
- [ ] "The review_requested webhook path is reliably observable end-to-end from delivery receipt through queue completion"
- [ ] "The deployed production revision remains healthy while serving the hardened review_requested flow"
- [ ] "Replay evidence can be used to prove no silent drop between webhook ingress, routing, gating, and execution"

## Files

- `src/routes/webhooks.ts`
- `src/webhook/router.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/jobs/queue.ts`
- `src/jobs/types.ts`
- `src/execution/config.test.ts`
- `docs/runbooks/review-requested-debug.md`
- `.planning/phases/10-review-request-reliability/10-02-SUMMARY.md`
