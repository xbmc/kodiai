---
phase: 81-slack-write-mode-enablement
plan: 02
subsystem: slack
tags: [slack, write-mode, pr-publish, policy-guardrails, metadata-mirroring]

requires:
  - phase: 81-01
    provides: Slack write-intent routing with confirmation/clarification gates
provides:
  - Dedicated Slack write runner that executes write-mode requests and publishes only via deterministic branch + PR flow
  - Policy/permission/unsupported-repo refusals with exact retry command guidance for Slack write runs
  - Execution publish metadata plumbing for comment URLs/excerpts mirrored in Slack thread replies
affects: [81-03, slack-assistant, write-publish-flow]

tech-stack:
  added: []
  patterns:
    - Trusted Slack write publish path using createBranchCommitAndPush plus explicit PR creation
    - Execution publish-event metadata capture for comment mirroring in Slack

key-files:
  created:
    - src/slack/write-runner.ts
    - src/slack/write-runner.test.ts
  modified:
    - src/slack/assistant-handler.ts
    - src/slack/assistant-handler.test.ts
    - src/index.ts
    - src/execution/types.ts
    - src/execution/executor.ts
    - src/execution/mcp/index.ts
    - src/execution/mcp/comment-server.ts

key-decisions:
  - "Slack write publish remains PR-only in trusted code: executor edits workspace, runner performs branch commit/push and pulls.create"
  - "Write-mode can keep comment MCP tools enabled when explicitly requested so Slack can mirror created comment links/excerpts"
  - "Slack success replies default to primary PR link, adding mirrored comment links only when comment publish events exist"

patterns-established:
  - "Slack write refusal contract always includes reason plus exact retry command"
  - "Comment publish metadata is emitted from MCP comment server and carried through ExecutionResult.publishEvents"

duration: 7 min
completed: 2026-02-19
---

# Phase 81 Plan 02: Slack Write Execution and Publish Metadata Summary

**Slack write-mode now executes guarded repository edits through trusted PR-only publish flow and mirrors GitHub comment publication links/excerpts back into the Slack thread when comments are created.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-19T00:55:13Z
- **Completed:** 2026-02-19T01:02:40Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added `createSlackWriteRunner` to run Slack write requests with repo-installation resolution, write config enforcement, deterministic branch/PR publish, and refusal/failure guidance.
- Wired Slack assistant write route through the dedicated runner while preserving existing read-only execution path and override acknowledgements.
- Added execution publish metadata plumbing (`publishEvents`) so comment tool publications emit URL + excerpt payloads.
- Updated Slack final reply formatting to always show the primary PR link and mirror comment links/excerpts only when comment publications occur.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build Slack write runner with PR-only publish and existing policy/permission gates** - `c475f11a7e` (feat)
2. **Task 2: Wire write publish metadata into Slack final reply with GitHub links and excerpts** - `ba04390935` (feat)

**Plan metadata:** `TBD` (docs: complete plan)

## Files Created/Modified
- `src/slack/write-runner.ts` - Dedicated Slack write execution orchestrator with policy/permission/refusal outcomes and deterministic PR publish.
- `src/slack/write-runner.test.ts` - Regression coverage for success, policy refusal, and unsupported repo refusal outcomes.
- `src/slack/assistant-handler.ts` - Write path now delegates to write runner and formats mirrored comment metadata in final Slack replies.
- `src/slack/assistant-handler.test.ts` - Added write runner integration tests for PR link output, comment mirror output, and refusal retry guidance.
- `src/index.ts` - Runtime wiring for shared Slack write runner with installation-context resolution, write-mode executor config, and PR creation.
- `src/execution/types.ts` - Added structured publish-event metadata contract for execution results.
- `src/execution/executor.ts` - Captures publish events from MCP tools and preserves them on success/error returns.
- `src/execution/mcp/index.ts` - Propagates publish-event callback into comment server wiring.
- `src/execution/mcp/comment-server.ts` - Emits comment publish metadata (URL + excerpt) for create/update comment tool actions.

## Decisions Made
- Kept trusted-code write publish responsibilities in Slack runner so default/protected branches are never written directly by assistant output.
- Allowed write-mode comment tools only when explicitly enabled by caller, preserving default write-mode safety while supporting Slack mirror requirements.
- Standardized Slack write success and refusal formatting around deterministic contracts (primary PR link first; reason + retry command for non-success).

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates
None - no authentication gates were encountered.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Slack write execution foundation is in place with deterministic publish and refusal contracts.
- Phase 81-03 can now focus on high-impact confirmation flow UX using the new runner outputs and metadata plumbing.

---
*Phase: 81-slack-write-mode-enablement*
*Completed: 2026-02-19*

## Self-Check: PASSED

- FOUND: `.planning/phases/81-slack-write-mode-enablement/81-02-SUMMARY.md`
- FOUND: `c475f11a7e`
- FOUND: `ba04390935`
