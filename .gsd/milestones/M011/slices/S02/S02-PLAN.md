# S02: Read Only Intent Gating

**Goal:** Extend the issue mention prompt contract so non-prefixed issue replies are clearly read-only and include explicit apply/change opt-in commands when users ask for implementation.
**Demo:** Extend the issue mention prompt contract so non-prefixed issue replies are clearly read-only and include explicit apply/change opt-in commands when users ask for implementation.

## Must-Haves


## Tasks

- [x] **T01: 61-read-only-intent-gating 01** `est:0 min`
  - Extend the issue mention prompt contract so non-prefixed issue replies are clearly read-only and include explicit apply/change opt-in commands when users ask for implementation.

Purpose: ISSUE-02 requires clear read-only framing in issue Q&A before write-mode is allowed; this plan locks that behavior with prompt-level contract tests.
Output: Updated `buildMentionPrompt()` issue instructions and tests that fail if read-only or opt-in command guidance regresses.
- [x] **T02: 61-read-only-intent-gating 02** `est:2 min`
  - Enforce read-only intent gating in the mention handler so issue-thread change requests do not enter write execution without explicit prefix intent and users get deterministic opt-in commands.

Purpose: SAFE-01 and ISSUE-02 require runtime guarantees, not prompt-only behavior, for issue surfaces.
Output: Mention handler gating updates plus tests proving issue write paths remain blocked without explicit `apply:`/`change:` and that users get exact opt-in commands.
- [x] **T03: 61-read-only-intent-gating 03** `est:2 min`
  - Close the Phase 61 live-verification gap where a non-prefixed issue change request produced an "Updated ..." style completion response instead of deterministic read-only opt-in guidance.

Purpose: ISSUE-02 and SAFE-01 require fail-closed behavior on issue comments; live Trigger A showed the current gate can miss a real implementation ask shape.
Output: Hardened issue intent gate + stronger issue prompt guardrails + regression tests that reproduce the failing request text and prevent future regressions.

## Files Likely Touched

- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
