# T01: 83-slack-response-conciseness 01

**Slice:** S02 — **Milestone:** M016

## Description

Rewrite the Slack assistant system prompt so responses read like chat messages from a senior engineer teammate: answer-first, concise, no AI-isms, no trailing sections, casual tone.

Purpose: Slack users currently get documentation-style responses with preambles, headers, and Sources sections. This makes Kodiai feel robotic rather than like a knowledgeable colleague.
Output: Updated `buildSlackAssistantPrompt` function and corresponding test assertions.

## Must-Haves

- [ ] "Slack system prompt enforces answer-first opening with no preamble phrases"
- [ ] "Slack system prompt bans Sources/References trailing sections"
- [ ] "Slack system prompt calibrates length: 1 sentence for simple, ~5 sentences for complex, with truncate-and-offer pattern"
- [ ] "Slack system prompt enforces casual conversational tone with no headers for simple answers"
- [ ] "Slack system prompt bans all AI-isms and filler phrases"

## Files

- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
