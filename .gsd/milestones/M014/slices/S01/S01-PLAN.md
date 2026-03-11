# S01: Slack Ingress Safety Rails

**Goal:** Add a secure Slack ingress endpoint that validates request signatures and timestamps before any event processing.
**Demo:** Add a secure Slack ingress endpoint that validates request signatures and timestamps before any event processing.

## Must-Haves


## Tasks

- [x] **T01: 77-slack-ingress-safety-rails 01** `est:2 min`
  - Add a secure Slack ingress endpoint that validates request signatures and timestamps before any event processing.

Purpose: SLK-01 is the hard security gate for Slack v1; without verified ingress, later thread and assistant behavior can be spoofed.
Output: Slack config/env support, signature verification module, mounted events route, and regression tests proving fail-closed behavior.
- [x] **T02: 77-slack-ingress-safety-rails 02** `est:2 min`
  - Enforce Slack v1 low-noise safety rails after ingress verification: single channel scope, no DMs, thread-only targeting, and mention-only thread bootstrap.

Purpose: SLK-02 and existing no-unsolicited-response policy require hard gating before any assistant behavior so Slack does not become noisy or unsafe.
Output: Rail evaluation module, route wiring, and regression tests for allowed vs blocked Slack scenarios.

## Files Likely Touched

- `src/config.ts`
- `src/slack/verify.ts`
- `src/slack/verify.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
- `src/index.ts`
- `src/slack/types.ts`
- `src/slack/safety-rails.ts`
- `src/slack/safety-rails.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
