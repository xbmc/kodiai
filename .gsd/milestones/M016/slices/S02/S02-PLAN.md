# S02: Slack Response Conciseness

**Goal:** Rewrite the Slack assistant system prompt so responses read like chat messages from a senior engineer teammate: answer-first, concise, no AI-isms, no trailing sections, casual tone.
**Demo:** Rewrite the Slack assistant system prompt so responses read like chat messages from a senior engineer teammate: answer-first, concise, no AI-isms, no trailing sections, casual tone.

## Must-Haves


## Tasks

- [x] **T01: 83-slack-response-conciseness 01** `est:1min`
  - Rewrite the Slack assistant system prompt so responses read like chat messages from a senior engineer teammate: answer-first, concise, no AI-isms, no trailing sections, casual tone.

Purpose: Slack users currently get documentation-style responses with preambles, headers, and Sources sections. This makes Kodiai feel robotic rather than like a knowledgeable colleague.
Output: Updated `buildSlackAssistantPrompt` function and corresponding test assertions.

## Files Likely Touched

- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
