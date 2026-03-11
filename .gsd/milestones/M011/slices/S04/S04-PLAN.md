# S04: Intent Gate Idempotency Foundations

**Goal:** Restore explicit opt-in safety for non-prefixed issue implementation asks.
**Demo:** Restore explicit opt-in safety for non-prefixed issue implementation asks.

## Must-Haves


## Tasks

- [x] **T01: 63-intent-gate-idempotency-foundations 01** `est:1 min`
  - Restore explicit opt-in safety for non-prefixed issue implementation asks.

Purpose: Phase 62 introduced implicit intent detection that auto-enters write mode for non-prefixed implementation asks (e.g., "fix the login bug"). This violates ISSUE-02 and SAFE-01 which require explicit `apply:`/`change:` prefixes for write mode. The fix changes the handler so implicit intent detection produces a read-only opt-in guidance reply (containing exact `@kodiai apply: <request>` and `@kodiai change: <request>` commands) instead of silently entering write mode.

Output: Handler code that gates implicit issue intents to guidance-only replies, with TDD regression coverage.
- [x] **T02: 63-intent-gate-idempotency-foundations 02** `est:3 min`
  - Lock issue-surface idempotency, in-flight de-dupe, and rate limiting with focused regression tests.

Purpose: The idempotency (existing PR reuse), in-flight de-dupe (process-local lock), and rate limiting mechanisms exist in the handler but only have PR-surface test coverage. Phase 63 requires these to be verified for issue-surface write requests specifically. Adding issue-surface regression tests closes IWR-02 and SAFE-02 gaps.

Output: Three focused issue-surface regression tests validating replay idempotency, concurrent de-dupe, and rate limiting.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/mention.test.ts`
