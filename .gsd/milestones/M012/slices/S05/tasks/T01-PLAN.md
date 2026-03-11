# T01: 70-cross-surface-conversational-ux 01

**Slice:** S05 — **Milestone:** M012

## Description

Unify conversational response behavior across issue, PR, and review-thread mention surfaces.

Purpose: CONV-01 and CONV-02 require one consistent response contract and a deterministic clarifying fallback when context is missing, without weakening existing safety gates.
Output: Updated mention prompt/handler behavior where all mention surfaces follow one contract and ask one targeted clarifying question when insufficient context is available.

## Must-Haves

- [ ] "Issue, PR, and review-thread mention prompts all instruct the same response contract: direct answer, evidence pointers, and next-step framing"
- [ ] "When context is insufficient, the response contract asks exactly one targeted clarifying question instead of speculative guidance"
- [ ] "Surface safety rules remain explicit: no unsolicited responses and no implicit write-mode entry outside issue-comment intent gates"

## Files

- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
