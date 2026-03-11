# T03: 10-review-request-reliability 03

**Slice:** S09 — **Milestone:** M001

## Description

Close the primary reliability gap by adding deterministic downstream idempotency for review output publication, so one manual `pull_request.review_requested` delivery cannot fan out into multiple review batches.

Purpose: Enforce exactly-once output semantics even if ingress dedup is bypassed or retries/restarts re-enter the review path.
Output: Idempotency-keyed review publication guard wired through review handler and MCP output path.

## Must-Haves

- [ ] "A single manual review_requested delivery publishes at most one review output batch"
- [ ] "Retry/replay processing for the same delivery/output key is skipped safely without duplicate review output"
- [ ] "Review trigger model remains opened, ready_for_review, and review_requested only (no synchronize trigger)"

## Files

- `src/handlers/review.ts`
- `src/handlers/review-idempotency.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/mcp/index.ts`
- `src/execution/mcp/inline-review-server.ts`
