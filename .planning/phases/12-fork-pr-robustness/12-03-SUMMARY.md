---
phase: 12-fork-pr-robustness
plan: 03
subsystem: infra
tags: [github, octokit, pagination, prompt, guardrails, runbook]

# Dependency graph
requires:
  - phase: 12-fork-pr-robustness
    provides: fork-safe workspace strategy for PR review/mention flows
provides:
  - Bounded, paginated context collectors for large PRs and long threads
  - Explicit truncation notes in prompts when caps are hit
  - Operator runbook for diagnosing scale-related failures
affects: [mentions, pr-review, operations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Paginate GitHub list endpoints with hard caps and early-exit scanning"
    - "Degrade safely + explicitly: insert 'Scale Notes' when context is partial"

key-files:
  created:
    - docs/runbooks/scale.md
  modified:
    - src/execution/mention-context.ts
    - src/execution/review-prompt.ts
    - src/handlers/review.ts
    - src/handlers/review-idempotency.ts

key-decisions:
  - "Use descending sort + bounded pagination for list APIs to avoid single-page partial reads while keeping API usage deterministic."
  - "Skip auto-approval when review-comment scanning hits safety caps (safe degradation over false approvals)."

patterns-established:
  - "Scale Notes: prompts include explicit truncation notes whenever caps are hit"

# Metrics
duration: 6 min
completed: 2026-02-10
---

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
