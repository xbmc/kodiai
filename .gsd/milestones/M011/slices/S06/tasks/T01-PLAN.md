# T01: 65-permission-disabled-ux-completion 01

**Slice:** S06 — **Milestone:** M011

## Description

Harden disabled-write UX for issue apply/change requests so users receive deterministic, actionable remediation instead of a generic refusal.

Purpose: Satisfy PERM-02 by ensuring write-mode-disabled responses always tell users exactly what to change and how to retry without guesswork.
Output: Updated disabled-write refusal copy in `mention.ts` plus regression tests that lock `.kodiai.yml` guidance and retry instructions.

## Must-Haves

- [ ] "When an issue `@kodiai apply:` or `@kodiai change:` request arrives while write mode is disabled, Kodiai replies in-thread with an actionable enablement message"
- [ ] "The disabled-write reply includes the minimal `.kodiai.yml` snippet needed to enable write mode"
- [ ] "The disabled-write reply tells the user they can retry the same apply/change command after enabling write mode"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
