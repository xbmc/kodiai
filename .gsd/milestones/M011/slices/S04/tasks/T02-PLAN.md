# T02: 63-intent-gate-idempotency-foundations 02

**Slice:** S04 — **Milestone:** M011

## Description

Lock issue-surface idempotency, in-flight de-dupe, and rate limiting with focused regression tests.

Purpose: The idempotency (existing PR reuse), in-flight de-dupe (process-local lock), and rate limiting mechanisms exist in the handler but only have PR-surface test coverage. Phase 63 requires these to be verified for issue-surface write requests specifically. Adding issue-surface regression tests closes IWR-02 and SAFE-02 gaps.

Output: Three focused issue-surface regression tests validating replay idempotency, concurrent de-dupe, and rate limiting.

## Must-Haves

- [ ] "Replaying the same issue apply:/change: trigger reuses the existing PR and replies with Existing PR link instead of creating a duplicate"
- [ ] "Concurrent in-flight duplicate issue write requests receive a single clear 'already in progress' reply instead of duplicate work"
- [ ] "Rate-limited issue write requests receive a single clear retry-later message without thrashing"

## Files

- `src/handlers/mention.test.ts`
