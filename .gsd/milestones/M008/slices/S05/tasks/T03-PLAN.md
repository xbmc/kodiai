# T03: 46-conversational-review 03

**Slice:** S05 — **Milestone:** M008

## Description

Wire conversational review into the mention handler with rate limiting, sanitization, context budget, and finding lookup integration.

Purpose: Complete the conversational review feature by connecting all the primitives from plans 01 and 02 into the live mention handler. After this plan, a user can reply to a kodiai review finding with @kodiai and receive a contextual, rate-limited, sanitized response.

Output: Fully operational conversational review in the mention handler.

## Must-Haves

- [ ] "User can reply to a kodiai review finding with @kodiai and receive a contextual response referencing the original finding"
- [ ] "Conversation threads are rate-limited per PR to prevent runaway token costs"
- [ ] "Bot replies have outgoing mentions sanitized to prevent self-trigger loops"
- [ ] "Context budget caps total conversation context characters per turn"
- [ ] "Comment-author defense-in-depth prevents processing if trigger comment author matches app slug"

## Files

- `src/handlers/mention.ts`
- `src/execution/mention-context.ts`
