---
phase: 79-slack-read-only-assistant-routing
plan: 02
subsystem: api
tags: [slack, routing, read-only, github-app, bun]

requires:
  - phase: 79-slack-read-only-assistant-routing
    provides: read-only Slack assistant core with deterministic repo-context resolution
provides:
  - Slack thread-only publish client with required bot token config and payload guardrails
  - Runtime installation-context lookup for arbitrary owner/repo Slack routing targets
  - End-to-end Slack ingress wiring from allowed events into read-only assistant execution and thread replies
affects: [80-slack-operator-hardening, slack-v1-routing, runtime-config]

tech-stack:
  added: []
  patterns: [thread-only Slack publish adapter, cached owner/repo installation context lookup, async fail-open Slack callback routing]

key-files:
  created:
    - src/slack/client.ts
    - src/slack/client.test.ts
    - .planning/phases/79-slack-read-only-assistant-routing/79-USER-SETUP.md
  modified:
    - src/config.ts
    - src/auth/github-app.ts
    - src/index.ts
    - src/routes/slack-events.ts
    - src/routes/slack-events.test.ts
    - src/execution/executor.ts
    - src/execution/types.ts

key-decisions:
  - "Resolved Slack repo runtime context with app-level owner/repo installation lookup plus default-branch cloning for deterministic workspace setup."
  - "Kept Slack ingress fail-open by always returning immediate 200 ack while catching and logging asynchronous assistant callback failures."
  - "Exposed successful executor final result text to let Slack routing publish deterministic assistant answers without enabling write/publish MCP tools."

patterns-established:
  - "Slack runtime composition pattern: route callback -> assistant handler -> workspace/executor/thread publisher adapters wired in index."
  - "Thread publish contract pattern: require thread_ts and send only channel/thread_ts/text payload shape to Slack API."

duration: 4 min
completed: 2026-02-18
---

# Phase 79 Plan 02: Slack Read-Only Assistant Routing Summary

**Slack allowed bootstrap and started-thread events now route end-to-end through read-only assistant execution and publish replies strictly to Slack thread targets using app installation-aware repo context.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-18T06:13:40Z
- **Completed:** 2026-02-18T06:17:43Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Added required `SLACK_BOT_TOKEN` config parsing and a new `createSlackClient(...)` adapter that enforces thread-only publish behavior.
- Extended GitHub app auth helpers with owner/repo installation-context lookup used by Slack default/override repo routing.
- Wired Slack ingress callback flow in `src/index.ts` to compose assistant handler dependencies (workspace creation, read-only executor invocation, thread publish) while preserving immediate ingress acknowledgement semantics.
- Added route regression coverage for callback rejection fail-open behavior and retained allowed/ignored forwarding guarantees.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Slack publishing and repo-installation runtime adapters for assistant routing** - `8325219104` (feat)
2. **Task 2: Wire Slack events route and app index into assistant callback flow with regressions** - `feb06fd451` (feat)

**Plan metadata:** Pending final docs commit.

## Files Created/Modified
- `src/slack/client.ts` - Thread-only Slack `chat.postMessage` adapter with explicit `thread_ts` guardrail.
- `src/slack/client.test.ts` - Verifies thread payload shape and missing-thread rejection behavior.
- `src/config.ts` - Adds required `SLACK_BOT_TOKEN` runtime config parsing.
- `src/auth/github-app.ts` - Adds owner/repo installation-context lookup for Slack runtime repo resolution.
- `src/index.ts` - Composes Slack assistant runtime dependencies and wires allowed event callback into handler.
- `src/routes/slack-events.ts` - Awaits callback inside async path so callback failures are caught/logged while ack remains immediate.
- `src/routes/slack-events.test.ts` - Adds regression proving immediate ack even when callback rejects.
- `src/execution/executor.ts` - Surfaces successful final result text for Slack answer publishing.
- `src/execution/types.ts` - Extends execution result contract with optional `resultText`.
- `.planning/phases/79-slack-read-only-assistant-routing/79-USER-SETUP.md` - Documents required Slack bot token and scope setup.

## Decisions Made
- Used installation-context lookup by `owner/repo` to keep Slack default and override repo execution deterministic without hardcoded installation IDs.
- Cached resolved installation context per `owner/repo` in process to avoid duplicate API lookups inside single runtime execution paths.
- Preserved fail-open ingress behavior by isolating assistant callback execution in async flow with explicit rejection handling and logging.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Exposed assistant final text from executor result contract**
- **Found during:** Task 2 (index runtime wiring)
- **Issue:** Slack runtime needed assistant response text for thread publishing, but executor contract returned only telemetry/conclusion fields.
- **Fix:** Added optional `resultText` in execution result types and populated it from successful SDK result payload.
- **Files modified:** `src/execution/executor.ts`, `src/execution/types.ts`
- **Verification:** Route + safety + typecheck suite passed after runtime wiring used `resultText`.
- **Committed in:** `feb06fd451` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required for correct end-to-end Slack reply publishing; no scope creep beyond routing objective.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

External services require manual configuration. See `79-USER-SETUP.md` for Slack token retrieval and bot scope checks.

## Next Phase Readiness

Phase 79 routing is complete with thread-only publishing and read-only execution wiring; Phase 80 can focus on operator hardening, smoke validation, and runbook/regression coverage.

---
*Phase: 79-slack-read-only-assistant-routing*
*Completed: 2026-02-18*

## Self-Check: PASSED

- Verified summary and user-setup files exist on disk.
- Verified task commit hashes exist in git history.
