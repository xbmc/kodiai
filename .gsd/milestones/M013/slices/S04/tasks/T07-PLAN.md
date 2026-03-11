# T07: 75-live-ops-verification-closure 07

**Slice:** S04 — **Milestone:** M013

## Description

Fix OPS75 verifier scope mismatch and provide operator trigger procedure for remaining production evidence gaps.

Purpose: OPS75-CACHE-02 checks mention-lane rate_limit_events rows, but the mention handler (`src/handlers/mention.ts`) does not use Search API author classification and never calls `recordRateLimitEvent`. This is a verifier scope error, not a production data gap. Removing this invalid check and simplifying the matrix to review-only cache evidence unblocks closure. Additionally, the operator needs a documented procedure to trigger cache-hit and degraded review runs.

Output: Corrected verifier script and operator trigger runbook enabling fresh evidence capture.

## Must-Haves

- [ ] "OPS75-CACHE-02 check is removed or rescoped because the mention handler does not use Search API cache and never emits rate_limit_events rows"
- [ ] "OPS75 verifier accepts review-only cache evidence without requiring mention-lane rate_limit_events rows that the codebase never produces"
- [ ] "Operator runbook documents exact steps to trigger cache-hit and degraded review runs for fresh OPS75 evidence capture"

## Files

- `scripts/phase75-live-ops-verification-closure.ts`
- `docs/runbooks/review-requested-debug.md`
