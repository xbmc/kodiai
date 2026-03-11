---
id: S03
parent: M014
milestone: M014
provides:
  - Deterministic Slack repo-context resolver with default xbmc/xbmc, explicit override acknowledgement, and ambiguity outcomes
  - Read-only Slack assistant handler core that short-circuits ambiguous repo context with one clarifying question
  - Execution contract enforcement with writeMode=false and publish/comment tool paths disabled
  - Slack thread-only publish client with required bot token config and payload guardrails
  - Runtime installation-context lookup for arbitrary owner/repo Slack routing targets
  - End-to-end Slack ingress wiring from allowed events into read-only assistant execution and thread replies
requires: []
affects: []
key_files: []
key_decisions:
  - "Repo context defaults to xbmc/xbmc unless exactly one explicit owner/repo override is present."
  - "Ambiguous or malformed repo references publish exactly one deterministic clarifying question and skip execution."
  - "Slack assistant execution is enforced read-only via writeMode=false plus inline/comment publish tool disablement and explicit prompt constraints."
  - "Resolved Slack repo runtime context with app-level owner/repo installation lookup plus default-branch cloning for deterministic workspace setup."
  - "Kept Slack ingress fail-open by always returning immediate 200 ack while catching and logging asynchronous assistant callback failures."
  - "Exposed successful executor final result text to let Slack routing publish deterministic assistant answers without enabling write/publish MCP tools."
patterns_established:
  - "Repo-context pattern: resolve to default, override, or ambiguity before any workspace or executor invocation."
  - "Slack handler seam pattern: publish/workspace/executor dependencies are injected for deterministic unit testing."
  - "Slack runtime composition pattern: route callback -> assistant handler -> workspace/executor/thread publisher adapters wired in index."
  - "Thread publish contract pattern: require thread_ts and send only channel/thread_ts/text payload shape to Slack API."
observability_surfaces: []
drill_down_paths: []
duration: 4 min
verification_result: passed
completed_at: 2026-02-18
blocker_discovered: false
---
# S03: Slack Read Only Assistant Routing

**# Phase 79 Plan 01: Slack Read-Only Assistant Routing Summary**

## What Happened

# Phase 79 Plan 01: Slack Read-Only Assistant Routing Summary

**Slack requests now route through deterministic repo-context resolution and a read-only assistant handler that executes only for unambiguous context, with one-question clarification when context is unclear.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-18T05:59:35Z
- **Completed:** 2026-02-18T06:02:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `resolveSlackRepoContext(...)` to deterministically return default, override+acknowledgement, or ambiguity+single-question outcomes.
- Added `createSlackAssistantHandler(...)` core flow with ambiguity short-circuit, workspace/executor sequencing, and in-thread publishing.
- Locked SLK-04/SLK-05 contracts with focused unit tests covering read-only executor invocation, default routing, override acknowledgement, and ambiguity no-execution behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deterministic Slack repo-context resolution for default, override, and ambiguity** - `c8cbc8bb2f` (feat)
2. **Task 2: Implement Slack read-only assistant handler core with ambiguity short-circuit** - `fbcdd47949` (feat)

**Plan metadata:** Recorded in the final docs commit for this plan.

## Files Created/Modified
- `src/slack/repo-context.ts` - Pure repo-context resolver with deterministic default/override/ambiguity outcomes.
- `src/slack/repo-context.test.ts` - Test matrix for default, single override acknowledgement, and ambiguous malformed/multi-repo inputs.
- `src/slack/assistant-handler.ts` - Read-only Slack assistant orchestration with workspace+executor+publish seams.
- `src/slack/assistant-handler.test.ts` - Contract tests for read-only execution flags, default routing, override prepend behavior, and ambiguity short-circuit.

## Decisions Made
- Defaulted Slack repo context to `xbmc/xbmc` when no explicit repo reference is present to keep low-friction behavior deterministic.
- Treated malformed/incomplete repo references as ambiguity to avoid accidental execution against unintended repositories.
- Kept handler dependencies injected and module-local prompt construction explicit so later route wiring can reuse the core without changing contracts.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 79 plan 01 core logic is complete and test-locked; plan 79-02 can now wire Slack ingress/runtime dependencies into this handler with regression coverage.

---
*Phase: 79-slack-read-only-assistant-routing*
*Completed: 2026-02-18*

## Self-Check: PASSED

- Verified key created files exist on disk.
- Verified task commit hashes exist in git history.

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
