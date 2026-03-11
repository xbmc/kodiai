# S02: Slack Thread Session Semantics

**Goal:** Implement Slack thread session semantics so @kodiai bootstrap starts a thread session and later thread replies in that session are treated as addressed without re-mentioning.
**Demo:** Implement Slack thread session semantics so @kodiai bootstrap starts a thread session and later thread replies in that session are treated as addressed without re-mentioning.

## Must-Haves


## Tasks

- [x] **T01: 78-slack-thread-session-semantics 01** `est:2 min`
  - Implement Slack thread session semantics so @kodiai bootstrap starts a thread session and later thread replies in that session are treated as addressed without re-mentioning.

Purpose: This satisfies SLK-03 while preserving v1 low-noise behavior from Phase 77 (explicit bootstrap only, thread-only replies, deterministic ignores for out-of-scope traffic).
Output: Thread session state module, updated rail decision logic, route wiring, and regression tests for starter vs non-starter follow-up paths.

## Files Likely Touched

- `src/slack/thread-session-store.ts`
- `src/slack/thread-session-store.test.ts`
- `src/slack/safety-rails.ts`
- `src/slack/safety-rails.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
