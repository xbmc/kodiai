# S06: Permission Disabled Ux Completion

**Goal:** Harden disabled-write UX for issue apply/change requests so users receive deterministic, actionable remediation instead of a generic refusal.
**Demo:** Harden disabled-write UX for issue apply/change requests so users receive deterministic, actionable remediation instead of a generic refusal.

## Must-Haves


## Tasks

- [x] **T01: 65-permission-disabled-ux-completion 01** `est:2m 14s`
  - Harden disabled-write UX for issue apply/change requests so users receive deterministic, actionable remediation instead of a generic refusal.

Purpose: Satisfy PERM-02 by ensuring write-mode-disabled responses always tell users exactly what to change and how to retry without guesswork.
Output: Updated disabled-write refusal copy in `mention.ts` plus regression tests that lock `.kodiai.yml` guidance and retry instructions.
- [x] **T02: 65-permission-disabled-ux-completion 02** `est:3m18s`
  - Implement permission-failure UX for issue write-mode so push/PR-create authorization errors produce actionable, non-sensitive remediation guidance.

Purpose: Satisfy PERM-01 by replacing generic API-error fallbacks with deterministic permission guidance that users can act on to successfully retry.
Output: Permission-aware write failure handling in `mention.ts` and regression tests proving issue-thread replies include minimum permission requirements.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
