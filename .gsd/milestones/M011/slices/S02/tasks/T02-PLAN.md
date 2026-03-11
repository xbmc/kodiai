# T02: 61-read-only-intent-gating 02

**Slice:** S02 — **Milestone:** M011

## Description

Enforce read-only intent gating in the mention handler so issue-thread change requests do not enter write execution without explicit prefix intent and users get deterministic opt-in commands.

Purpose: SAFE-01 and ISSUE-02 require runtime guarantees, not prompt-only behavior, for issue surfaces.
Output: Mention handler gating updates plus tests proving issue write paths remain blocked without explicit `apply:`/`change:` and that users get exact opt-in commands.

## Must-Haves

- [ ] "Issue-thread writes are never executed unless explicit apply/change intent is present"
- [ ] "Issue comments that request code changes without apply/change receive an explicit prefix command to opt in"
- [ ] "Regular issue Q&A remains read-only and continues to produce one in-thread reply"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
