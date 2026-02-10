---
phase: 10-review-request-reliability
plan: 01
subsystem: webhook-review-flow
tags: [webhooks, routing, review-requested, observability, runbook]

# Dependency graph
requires:
  - 09-review-ux-improvements/09-05-PLAN.md
provides:
  - End-to-end `deliveryId` correlation across ingress, router, review gate, and queue execution logs
  - Hardened `review_requested` reviewer matching for case and `[bot]` variance
  - Explicit skip reasons for team-only and malformed reviewer payloads
  - Additional trigger-config regression tests and production debug runbook
affects: [webhook-ingress, event-router, review-handler, job-queue, runbooks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Log gate decisions with stable fields: gate, gateResult, skipReason"
    - "Attach webhook context to queued jobs for execution lifecycle correlation"

key-files:
  created:
    - src/handlers/review.test.ts
    - docs/runbooks/review-requested-debug.md
    - .planning/phases/10-review-request-reliability/10-01-SUMMARY.md
  modified:
    - src/routes/webhooks.ts
    - src/webhook/router.ts
    - src/handlers/review.ts
    - src/jobs/queue.ts
    - src/jobs/types.ts
    - src/execution/config.test.ts

key-decisions:
  - "Normalize reviewer/app logins by lowercasing and removing trailing [bot] for deterministic review_requested matching"
  - "Treat team-only and malformed review_requested payloads as non-fatal skips with explicit diagnostics"
  - "Pass queue context (deliveryId/event/action/jobType/prNumber) into queue lifecycle logs"

patterns-established:
  - "Router emits dispatch observability before handler execution (specificKey/generalKey counts)"
  - "Review handler logs enqueue start/completion around queue submission"

# Metrics
duration: 34 min
completed: 2026-02-08
---

# Phase 10 Plan 1: Review Request Reliability Summary

Implemented reliability hardening for `pull_request.review_requested` with correlated observability and deterministic gating.

## Verification Evidence

- `bun test src/execution/config.test.ts src/handlers/review.test.ts` passed (15 tests, 0 failures).
- `bunx tsc --noEmit` still fails due pre-existing unrelated repository issues in `src/handlers/mention-types.ts` and `src/lib/sanitizer.test.ts`.
- Source grep confirms `deliveryId` is present at ingress (`src/routes/webhooks.ts`), router dispatch (`src/webhook/router.ts`), review gating/enqueue (`src/handlers/review.ts`), and queue start/finish logs (`src/jobs/queue.ts`).
- Production/live replay verification was documented in runbook steps but not executed in this local phase.

## Completed Work

- Added structured ingress log in `src/routes/webhooks.ts` with event metadata (`eventName`, `action`, `installationId`, repository, sender) before async dispatch.
- Expanded router observability in `src/webhook/router.ts` to report `specificKey`, `generalKey`, matched handler counts, and explicit filtered/no-handler outcomes.
- Hardened `review_requested` gate in `src/handlers/review.ts` with case-insensitive login matching and `[bot]` suffix normalization.
- Added explicit skip reasons/logs for non-kodiai reviewer, team-only request, missing/malformed reviewer payload, trigger disabled, and review disabled.
- Added enqueue boundary logs and forwarded webhook context into queue lifecycle logs for end-to-end correlation.
- Enhanced queue logging in `src/jobs/queue.ts` with job IDs and start/finish/failure events.
- Added tests in `src/handlers/review.test.ts` for positive re-request, non-kodiai reviewer skip, team-only skip, and malformed payload skip.
- Added config regressions in `src/execution/config.test.ts` for omitted trigger defaults and explicit `onReviewRequested: false` behavior.
- Authored `docs/runbooks/review-requested-debug.md` with GitHub delivery checks, log-correlation flow, triage matrix, and smoke procedure.

## Deviations from Plan

- Did not run a live production smoke test; instead produced concrete runbook commands and local verification.

## Next Phase Readiness

- Review-requested path is instrumented and test-covered for key gating variants.
- On-call debugging path now exists end-to-end via `X-GitHub-Delivery` correlation.
