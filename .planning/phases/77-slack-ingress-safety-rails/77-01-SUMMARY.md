---
phase: 77-slack-ingress-safety-rails
plan: 01
subsystem: api
tags: [slack, webhook, security, hono, hmac]

requires:
  - phase: 76-success-path-status-contract-parity
    provides: stable webhook runtime and reliability baseline
provides:
  - Verified Slack ingress endpoint with fail-closed signature and timestamp checks
  - Replay-window-aware Slack verifier with structured failure reasons
  - Regression tests proving unverified requests are rejected before processing
affects: [77-02 safety rails, 78-thread-session-semantics, slack-ingress]

tech-stack:
  added: []
  patterns: [verify-before-parse webhook handling, fail-closed ingress auth, async webhook acknowledgment]

key-files:
  created:
    - src/slack/verify.ts
    - src/slack/verify.test.ts
    - src/routes/slack-events.ts
    - src/routes/slack-events.test.ts
  modified:
    - src/config.ts
    - src/index.ts

key-decisions:
  - "Slack ingress verifies raw request body and timestamp before JSON parsing to preserve signature integrity and fail closed."
  - "Verified event_callback requests return immediate 200 acknowledgment while downstream work is deferred asynchronously."

patterns-established:
  - "Security-first webhook pattern: read raw body, verify headers/signature/timestamp, then parse payload."
  - "Slack verifier returns structured reasons for reject telemetry without leaking secrets."

duration: 2 min
completed: 2026-02-18
---

# Phase 77 Plan 01: Verified Slack Ingress Summary

**Slack ingress now enforces v0 signature and replay-window validation before parsing, with secure `/webhooks/slack/events` mounting and regression coverage for fail-closed behavior.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-18T04:52:28Z
- **Completed:** 2026-02-18T04:55:06Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Extended startup config validation with required `SLACK_SIGNING_SECRET`, `SLACK_BOT_USER_ID`, and `SLACK_KODIAI_CHANNEL_ID`.
- Added `verifySlackRequest` primitive implementing Slack v0 HMAC verification, timing-safe compare, and +/-5 minute replay-window checks.
- Added and mounted `/webhooks/slack/events` route that verifies before parsing, rejects unauthenticated payloads with `401`, handles `url_verification`, and acknowledges valid callbacks immediately.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend runtime config for Slack ingress secrets and identities** - `027ff8c44f` (feat)
2. **Task 2: Implement Slack signature/timestamp verification primitive with replay-window checks** - `e5d6a192e4` (feat)
3. **Task 3: Add `/webhooks/slack/events` route with verify-first request handling** - `19ea0253df` (feat)

**Plan metadata:** Recorded in the final docs commit for this plan.

## Files Created/Modified
- `src/config.ts` - Adds fail-fast Slack env parsing for ingress identity and signing secret.
- `src/slack/verify.ts` - Implements Slack request authenticity checks and replay protection.
- `src/slack/verify.test.ts` - Verifies valid/invalid signature, missing headers, and timestamp skew behavior.
- `src/routes/slack-events.ts` - Implements verified Slack events ingress route and async acknowledgment path.
- `src/routes/slack-events.test.ts` - Proves unverified requests are rejected before processing and verified flows succeed.
- `src/index.ts` - Mounts Slack ingress route at `/webhooks/slack/events`.

## Decisions Made
- Kept Slack verifier return type structured (`valid` + `reason`) so route logs can surface actionable rejection cause safely.
- Added explicit invalid JSON handling (`400`) after successful verification to prevent unhandled route exceptions while preserving verify-first behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

External services require manual configuration. See `77-USER-SETUP.md` for:
- Environment variables to add
- Slack App Event Subscriptions configuration
- Verification steps

## Next Phase Readiness
Plan 77-01 is complete and verified; phase is ready for 77-02 safety-rail enforcement (channel/thread/mention gating).

---
*Phase: 77-slack-ingress-safety-rails*
*Completed: 2026-02-18*

## Self-Check: PASSED

- Verified required files exist on disk.
- Verified task commit hashes are present in git history.
