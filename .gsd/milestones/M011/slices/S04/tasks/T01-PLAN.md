# T01: 63-intent-gate-idempotency-foundations 01

**Slice:** S04 — **Milestone:** M011

## Description

Restore explicit opt-in safety for non-prefixed issue implementation asks.

Purpose: Phase 62 introduced implicit intent detection that auto-enters write mode for non-prefixed implementation asks (e.g., "fix the login bug"). This violates ISSUE-02 and SAFE-01 which require explicit `apply:`/`change:` prefixes for write mode. The fix changes the handler so implicit intent detection produces a read-only opt-in guidance reply (containing exact `@kodiai apply: <request>` and `@kodiai change: <request>` commands) instead of silently entering write mode.

Output: Handler code that gates implicit issue intents to guidance-only replies, with TDD regression coverage.

## Must-Haves

- [ ] "Non-prefixed implementation asks in issue comments produce a read-only reply with explicit @kodiai apply: and @kodiai change: opt-in commands instead of entering write mode"
- [ ] "Explicit apply:/change: prefixed issue comments still enter write mode and create PRs normally"
- [ ] "Non-prefixed informational questions in issue comments are unaffected and pass through to normal executor flow"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
