# T02: 79-slack-read-only-assistant-routing 02

**Slice:** S03 — **Milestone:** M014

## Description

Wire Slack ingress and runtime dependencies into the Phase 79 assistant core so allowed Slack thread traffic reaches the read-only assistant end-to-end.

Purpose: This completes SLK-04 and SLK-05 by connecting route/index/runtime plumbing to the already-tested assistant core without regressing Phase 77/78 safety semantics.
Output: Slack client + runtime config wiring, repo installation lookup support, route/index integration, and regressions proving allowed forwarding and fail-open acknowledgments.

## Must-Haves

- [ ] "Allowed Slack bootstrap and started-thread follow-up payloads are forwarded into assistant handling while ingress still acknowledges immediately"
- [ ] "Assistant replies are posted to Slack thread targets only, never top-level channel posts"
- [ ] "Slack assistant routing preserves read-only behavior and deterministic repo-context outcomes introduced in 79-01"

## Files

- `src/config.ts`
- `src/auth/github-app.ts`
- `src/slack/client.ts`
- `src/slack/client.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
- `src/index.ts`
