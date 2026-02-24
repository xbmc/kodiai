# Phase 83: Slack Response Conciseness - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Slack responses read like chat messages from a knowledgeable colleague, not documentation pages. This phase changes the tone, formatting, and length of Kodiai's Slack replies. It does not add new Slack capabilities or change what triggers responses.

</domain>

<decisions>
## Implementation Decisions

### Response opening style
- Answer-first — jump straight to the answer with no greeting, preamble, or lead-in
- No closing or sign-off — end when the answer is done, never "Let me know if..." or "Hope that helps!"
- No trailing sections of any kind — no Sources, References, Related Files, Next Steps, or any appended section
- When Kodiai doesn't know: direct admission — "Not sure about that one" or equivalent, short and honest

### Formatting rules
- Simple questions: plain text with inline `backticks` for file paths and function names
- Complex questions: bullet points OK for lists, but never section headers (##) — keep it flat
- Code snippets: inline backticks for names, triple-backtick code blocks OK for 1-5 line snippets
- Emoji: sparingly, where it adds clarity (e.g. ⚠️ for warnings) but not decorative

### Length calibration
- Simple factual questions: 1 sentence max
- Explain/how-does-X-work questions: ~5 sentences / short paragraph, even for complex topics
- Overflow strategy: truncate to concise version, then "want the full breakdown?" — only expand if asked
- Unsolicited info: rarely, only if it's a critical gotcha or footgun the user should know about

### Personality & voice
- Casual tone — like a friend who knows the codebase. Contractions and informal phrasing OK
- Avoid first person — "that file doesn't exist" not "I don't see that file"
- Never hedge — state things definitively or say "not sure." No "I think..." or "it looks like..."
- Banned phrases: all AI-isms ("As an AI...", "Based on the codebase...", "Here's what I found...") AND all filler ("Certainly!", "Absolutely!", "Happy to help!", "Great question!", "Let me explain...")

### Claude's Discretion
- Exact emoji choices for warnings/critical info
- How to phrase the "want the full breakdown?" offer naturally
- Edge cases where a response genuinely needs more than 5 sentences

</decisions>

<specifics>
## Specific Ideas

- Responses should feel like Slack messages from a senior engineer teammate — someone you'd DM for a quick answer
- The "truncate + offer more" pattern should feel natural, not formulaic — vary the phrasing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 83-slack-response-conciseness*
*Context gathered: 2026-02-23*
