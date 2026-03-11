# S05: Cross Surface Conversational Ux

**Goal:** Unify conversational response behavior across issue, PR, and review-thread mention surfaces.
**Demo:** Unify conversational response behavior across issue, PR, and review-thread mention surfaces.

## Must-Haves


## Tasks

- [x] **T01: 70-cross-surface-conversational-ux 01** `est:2 min`
  - Unify conversational response behavior across issue, PR, and review-thread mention surfaces.

Purpose: CONV-01 and CONV-02 require one consistent response contract and a deterministic clarifying fallback when context is missing, without weakening existing safety gates.
Output: Updated mention prompt/handler behavior where all mention surfaces follow one contract and ask one targeted clarifying question when insufficient context is available.
- [x] **T02: 70-cross-surface-conversational-ux 02** `est:2 min`
  - Lock cross-surface conversational UX behavior with durable regression coverage.

Purpose: Prevent regressions after implementation by encoding CONV-01/CONV-02 and safety expectations directly in prompt and handler tests.
Output: A cross-surface clarification and safety regression suite covering issue, PR, and review-thread mention execution paths.

## Files Likely Touched

- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/mention.test.ts`
