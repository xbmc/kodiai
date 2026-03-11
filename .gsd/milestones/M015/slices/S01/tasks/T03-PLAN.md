# T03: 81-slack-write-mode-enablement 03

**Slice:** S01 — **Milestone:** M015

## Description

Add high-impact confirmation gates and complete Slack write response UX so write workflows stay safe and deterministic.

Purpose: Phase 81 needs deterministic confirmation behavior and user-facing write response contracts before operator verification gates are layered on.
Output: Confirmation-state module plus Slack response-contract wiring and tests.

## Must-Haves

- [ ] "High-impact Slack write requests pause for in-thread confirmation, while lower-impact requests run without confirmation"
- [ ] "If confirmation is not received, the write request remains pending and is not auto-canceled"
- [ ] "Slack write user experience provides balanced progress updates (start, key milestones, final)"
- [ ] "Final Slack success output is concise with changed-where bullets and defaults to the primary PR link"
- [ ] "Slack write refusal/failure responses include the reason and an exact retry/fix command"

## Files

- `src/slack/write-confirmation-store.ts`
- `src/slack/write-confirmation-store.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
