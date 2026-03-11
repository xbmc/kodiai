# T02: 77-slack-ingress-safety-rails 02

**Slice:** S01 — **Milestone:** M014

## Description

Enforce Slack v1 low-noise safety rails after ingress verification: single channel scope, no DMs, thread-only targeting, and mention-only thread bootstrap.

Purpose: SLK-02 and existing no-unsolicited-response policy require hard gating before any assistant behavior so Slack does not become noisy or unsafe.
Output: Rail evaluation module, route wiring, and regression tests for allowed vs blocked Slack scenarios.

## Must-Haves

- [ ] "Slack v1 processing is limited to the configured `#kodiai` channel and ignores DMs or other channels"
- [ ] "Thread bootstrap requires an explicit `@kodiai` mention on a top-level channel message"
- [ ] "Any allowed Slack assistant reply target is thread-only, never a new top-level channel post"

## Files

- `src/slack/types.ts`
- `src/slack/safety-rails.ts`
- `src/slack/safety-rails.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
