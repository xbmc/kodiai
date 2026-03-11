# T02: 70-cross-surface-conversational-ux 02

**Slice:** S05 — **Milestone:** M012

## Description

Lock cross-surface conversational UX behavior with durable regression coverage.

Purpose: Prevent regressions after implementation by encoding CONV-01/CONV-02 and safety expectations directly in prompt and handler tests.
Output: A cross-surface clarification and safety regression suite covering issue, PR, and review-thread mention execution paths.

## Must-Haves

- [ ] "Cross-surface mention prompts remain contract-consistent after future edits"
- [ ] "Insufficient-context behavior is locked to one targeted clarifying question instead of speculative or generic output"
- [ ] "Surface-specific safety/UX rules stay intact (no unsolicited responses, no implicit write-mode entry on PR/review surfaces)"

## Files

- `src/execution/mention-prompt.test.ts`
- `src/handlers/mention.test.ts`
