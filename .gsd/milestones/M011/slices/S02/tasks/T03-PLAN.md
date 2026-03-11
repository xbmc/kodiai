# T03: 61-read-only-intent-gating 03

**Slice:** S02 — **Milestone:** M011

## Description

Close the Phase 61 live-verification gap where a non-prefixed issue change request produced an "Updated ..." style completion response instead of deterministic read-only opt-in guidance.

Purpose: ISSUE-02 and SAFE-01 require fail-closed behavior on issue comments; live Trigger A showed the current gate can miss a real implementation ask shape.
Output: Hardened issue intent gate + stronger issue prompt guardrails + regression tests that reproduce the failing request text and prevent future regressions.

## Must-Haves

- [ ] "A non-prefixed issue implementation request never reaches executor and always gets exact @kodiai apply/change opt-in commands"
- [ ] "Issue read-only replies cannot claim completed repository edits when explicit apply/change intent is absent"
- [ ] "Issue informational questions still run through normal issue Q&A execution"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
