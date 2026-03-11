# T01: 79-slack-read-only-assistant-routing 01

**Slice:** S03 — **Milestone:** M014

## Description

Build the core Slack assistant domain logic: deterministic repo-context resolution and a read-only handler that executes only when context is unambiguous.

Purpose: This delivers the core SLK-04 and SLK-05 behavior before wiring so execution semantics are test-locked and reusable from route integration.
Output: Pure repo-context resolver + tests, assistant handler read-only execution flow + tests.

## Must-Haves

- [ ] "Slack assistant requests execute in read-only mode only (no write-mode edits, no branch/PR creation, no CI/build commands)"
- [ ] "If a Slack message does not name a repo, assistant context defaults to xbmc/xbmc"
- [ ] "If a Slack message names one explicit repo override, assistant replies acknowledge the override before answering"
- [ ] "If repo context is ambiguous, assistant posts exactly one clarifying question in-thread and does not run execution"

## Files

- `src/slack/repo-context.ts`
- `src/slack/repo-context.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
