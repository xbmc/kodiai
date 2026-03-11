# T01: 81-slack-write-mode-enablement 01

**Slice:** S01 — **Milestone:** M015

## Description

Define and wire Slack write-intent routing so explicit prefixes and medium-confidence conversational asks can enter write mode safely, while ambiguous asks stay read-only with a deterministic retry affordance.

Purpose: Phase 81 requires write-capable Slack routing without sacrificing deterministic safety when user intent is unclear.
Output: Intent-classification module, assistant routing integration, and tests locking prefix/conversational/ambiguous behavior.

## Must-Haves

- [ ] "Slack messages with explicit write prefixes (apply:/change:/plan:) route deterministically into write-capable intent handling"
- [ ] "Conversational Slack requests can route to write mode when medium-confidence thresholds are met, while ambiguous asks remain read-only"
- [ ] "Ambiguous write intent always returns a read-only response with an exact quick-action rerun command"
- [ ] "High-impact write asks are flagged for confirmation while lower-impact writes proceed without mandatory confirmation"

## Files

- `src/slack/write-intent.ts`
- `src/slack/write-intent.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
