# T02: 06-content-safety 02

**Slice:** S06 — **Milestone:** M001

## Description

Integrate content sanitization and TOCTOU filtering into all prompt builders.

Purpose: Wires the sanitizer module (from Plan 01) into every location where user-generated content enters the LLM prompt, closing both MENTION-06 (sanitization) and MENTION-07 (TOCTOU) requirements.
Output: All three prompt builder files modified to sanitize user content at the boundary.

## Must-Haves

- [ ] "Invisible unicode characters, HTML comments, and embedded tokens are stripped from all user content before it reaches the LLM"
- [ ] "Only comments that existed at or before the trigger timestamp are included in conversation context"

## Files

- `src/execution/mention-prompt.ts`
- `src/execution/review-prompt.ts`
- `src/execution/prompt.ts`
