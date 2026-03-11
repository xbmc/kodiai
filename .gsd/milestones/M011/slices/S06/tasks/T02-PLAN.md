# T02: 65-permission-disabled-ux-completion 02

**Slice:** S06 — **Milestone:** M011

## Description

Implement permission-failure UX for issue write-mode so push/PR-create authorization errors produce actionable, non-sensitive remediation guidance.

Purpose: Satisfy PERM-01 by replacing generic API-error fallbacks with deterministic permission guidance that users can act on to successfully retry.
Output: Permission-aware write failure handling in `mention.ts` and regression tests proving issue-thread replies include minimum permission requirements.

## Must-Haves

- [ ] "When issue write-mode PR creation fails due to missing GitHub App permissions, Kodiai replies in-thread with actionable remediation instead of a generic API error"
- [ ] "Permission refusal guidance lists minimum required permission scopes for write-mode PR creation"
- [ ] "Permission failure replies avoid leaking tokens, secret values, or raw sensitive payload fragments"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
