# T01: 77-slack-ingress-safety-rails 01

**Slice:** S01 — **Milestone:** M014

## Description

Add a secure Slack ingress endpoint that validates request signatures and timestamps before any event processing.

Purpose: SLK-01 is the hard security gate for Slack v1; without verified ingress, later thread and assistant behavior can be spoofed.
Output: Slack config/env support, signature verification module, mounted events route, and regression tests proving fail-closed behavior.

## Must-Haves

- [ ] "Slack events are rejected with 401 unless signature and timestamp validation passes"
- [ ] "Slack URL verification challenge returns only after request authenticity checks"
- [ ] "Valid Slack event callback requests are acknowledged quickly without blocking webhook response"

## Files

- `src/config.ts`
- `src/slack/verify.ts`
- `src/slack/verify.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
- `src/index.ts`
