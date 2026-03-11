---
id: S02
parent: M002
milestone: M002
provides:
  - "Fork PR reviews clone base repo and fetch pull/<n>/head (no fork clone required)"
  - "Workspace helper for fetching+checking out PR head refs"
  - "PR mention workspaces clone base repo and checkout pull/<n>/head (fork-safe)"
  - "Mention context safety invariants remain test-covered (TOCTOU, sanitization, bounds)"
  - Bounded, paginated context collectors for large PRs and long threads
  - Explicit truncation notes in prompts when caps are hit
  - Operator runbook for diagnosing scale-related failures
requires: []
affects: []
key_files: []
key_decisions:
  - "For fork (and deleted-fork) PRs, never clone pr.head.repo; clone base repo and fetch pull/<n>/head instead"
  - "Use base-clone + pull/<n>/head checkout for all PR mention workspaces (simpler and fork-safe)"
  - "Use descending sort + bounded pagination for list APIs to avoid single-page partial reads while keeping API usage deterministic."
  - "Skip auto-approval when review-comment scanning hits safety caps (safe degradation over false approvals)."
patterns_established:
  - "Log workspaceStrategy for PR reviews to make fork vs non-fork behavior explicit"
  - "Use local branch 'pr-mention' for PR head checkout in mention workspaces"
  - "Scale Notes: prompts include explicit truncation notes whenever caps are hit"
observability_surfaces: []
drill_down_paths: []
duration: 6 min
verification_result: passed
completed_at: 2026-02-10
blocker_discovered: false
---
# S02: Fork Pr Robustness

**# Phase 12 Plan 01: Fork PR Workspace Strategy Summary**

## What Happened

# Phase 12 Plan 01: Fork PR Workspace Strategy Summary

**Fork PR review workspaces are now built by cloning the base repo and fetching `pull/<n>/head`, avoiding any dependency on cloning contributor forks.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-10T03:01:52Z
- **Completed:** 2026-02-10T03:05:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Updated review handler to use base-clone + PR ref fetch for fork/deleted-fork PRs
- Added workspace helper for fetch+checkout of PR head refs (`pull/<n>/head`)
- Added regression tests covering fork vs non-fork strategy selection

## Task Commits

Each task was committed atomically:

1. **Task 1: Switch fork PR checkout to base-clone + refs/pull fetch** - `c22fc1066a` (feat)
2. **Task 2: Add regression coverage for fork PR strategy selection** - `8094fbd078` (test)

**Plan metadata:** (docs commit updates SUMMARY + STATE)

## Files Created/Modified
- `src/handlers/review.ts` - Select base-clone + PR ref fetch strategy for fork/deleted-fork PRs; add strategy logging
- `src/jobs/workspace.ts` - Add `fetchAndCheckoutPullRequestHeadRef()` helper with PR number validation
- `src/handlers/review.test.ts` - Tests asserting fork PRs fetch `pull/<n>/head` and non-fork PRs keep direct head-branch clone

## Decisions Made
- For fork and deleted-fork PRs, use the base repo's `pull/<n>/head` ref rather than cloning `pr.head.repo`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `12-02-PLAN.md` (additional robustness coverage)

---
*Phase: 12-fork-pr-robustness*
*Completed: 2026-02-10*

## Self-Check: PASSED

- FOUND: `.planning/phases/12-fork-pr-robustness/12-01-SUMMARY.md`
- FOUND: `c22fc1066a` (Task 1)
- FOUND: `8094fbd078` (Task 2)

# Phase 12 Plan 02: Mention Fork PR Robustness Summary

**PR mention workspaces now clone the base repo at the base ref and fetch+checkout `pull/<n>/head`, avoiding fork-clone access assumptions while preserving diff/code context.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-10T03:08:04Z
- **Completed:** 2026-02-10T03:13:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Updated mention handler PR workspace strategy to be fork-safe via `pull/<n>/head` checkout
- Added regression test asserting PR mention workspaces use base clone + pull ref fetch
- Extended mention-context tests to cover PR title/body sanitization and deterministic truncation

## Task Commits

Each task was committed atomically:

1. **Task 1: Use base-clone + PR-ref fetch strategy for PR mention contexts** - `8b8ee447f2` (feat)
2. **Task 2: Confirm mention context builder still obeys TOCTOU and sanitization** - `0a8918cf1f` (test)

**Plan metadata:** (docs commit updates SUMMARY + STATE)

## Files Created/Modified

- `src/handlers/mention.ts` - Clone base ref for PR mentions, then fetch+checkout `pull/<n>/head` into `pr-mention`
- `src/handlers/mention.test.ts` - Workspace strategy regression coverage using local `refs/pull/<n>/head` fixture
- `src/execution/mention-context.test.ts` - Added assertions for PR title/body sanitization + bounded truncation

## Decisions Made

- Use the PR ref strategy for all PR mentions (not fork-only) to keep logic simple and robust under GitHub App token constraints.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `12-03-PLAN.md`.

---

## Self-Check: PASSED

- FOUND: `.planning/phases/12-fork-pr-robustness/12-02-SUMMARY.md`
- FOUND: `8b8ee447f2` (Task 1)
- FOUND: `0a8918cf1f` (Task 2)

# Phase 12 Plan 03: Scale Guardrails Summary

**Paginated GitHub list collectors with deterministic caps and explicit truncation notes, plus an operator scale runbook.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-10T03:18:58Z
- **Completed:** 2026-02-10T03:25:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Bounded mention and review prompt builders to prevent unbounded context growth on large PRs/threads.
- Added explicit `## Scale Notes` sections so truncated/partial context is visible to the model and diagnosable in incidents.
- Made idempotency and auto-approval scans pagination-aware with safety caps.
- Added `docs/runbooks/scale.md` with concrete reproduction and tuning guidance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pagination + caps to context collectors** - `a4585453ed` (feat)
2. **Task 2: Add runbook for scale-related incidents** - `2af4c000b8` (docs)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified

- `src/execution/mention-context.ts` - Paginated issue-comment collection; adds caps and `Scale Notes` for partial context.
- `src/execution/review-prompt.ts` - Caps PR title/body and changed-file listing; emits `Scale Notes` when truncated.
- `src/handlers/review-idempotency.ts` - Scans for idempotency markers with bounded pagination (avoids single-page false negatives).
- `src/handlers/review.ts` - Bounded pagination for inline-comment detection; skips auto-approval when scanning is capped.
- `docs/runbooks/scale.md` - Incident runbook for scale symptoms, reproduction, and safe tuning.

## Decisions Made

- Used descending sort + bounded pagination for GitHub list endpoints to make large inputs deterministic without unbounded API usage.
- Chose safe degradation for auto-approval: if we cannot prove “no bot inline comments” due to scan caps, we skip approval.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Paginated idempotency marker scans to avoid duplicate output on large PRs**
- **Found during:** Task 1 (Add pagination + caps to context collectors)
- **Issue:** Idempotency checks used single-page list calls and could miss the review-output marker when comments exceeded a page.
- **Fix:** Added bounded, early-exit pagination for review comments, issue comments, and reviews.
- **Files modified:** `src/handlers/review-idempotency.ts`
- **Verification:** `bun test`
- **Committed in:** `a4585453ed`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential correctness hardening for scale; no scope creep beyond reliability goals.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 12 is complete. Scale behavior for large PRs/threads is bounded, explicit, and operator-diagnosable.

---
*Phase: 12-fork-pr-robustness*
*Completed: 2026-02-10*

## Self-Check: PASSED

- FOUND: `.planning/phases/12-fork-pr-robustness/12-03-SUMMARY.md`
- FOUND: `docs/runbooks/scale.md`
- FOUND COMMIT: `a4585453ed`
- FOUND COMMIT: `2af4c000b8`
