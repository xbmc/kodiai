---
phase: 10-review-request-reliability
plan: 03
subsystem: api
tags: [idempotency, review-requested, github-pr-review, mcp]

# Dependency graph
requires:
  - phase: 10-review-request-reliability/10-02-PLAN.md
    provides: delivery correlation and review_requested gating baseline
provides:
  - Deterministic review output key generation for one delivery-bound review batch
  - Handler-level and publication-level idempotency checks for duplicate/retry protection
  - Delivery/key correlated publication logs for skip vs publish outcomes
affects: [review-handler, execution-context, mcp-inline-publication]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Deterministic output key + marker guard before external side effects
    - One-time publication state caching per execution server instance

key-files:
  created:
    - .planning/phases/10-review-request-reliability/10-03-SUMMARY.md
    - src/handlers/review-idempotency.ts
  modified:
    - src/handlers/review.ts
    - src/handlers/review.test.ts
    - src/execution/types.ts
    - src/execution/executor.ts
    - src/execution/mcp/index.ts
    - src/execution/mcp/inline-review-server.ts

key-decisions:
  - "Review output identity is delivery-scoped using installation/repo/pr/action/delivery/head-sha fields."
  - "Inline publication checks marker existence once per run, then allows the initial batch while skipping retry/replay runs."

patterns-established:
  - "Idempotent external write pattern: check marker first, append marker on successful write, log outcome with correlation IDs."

# Metrics
duration: 3 min
completed: 2026-02-09
---

# Phase 10 Plan 3: Review Output Idempotency Summary

Deterministic `reviewOutputKey` generation is now wired from review handler into inline MCP publication, with marker-based guards that skip duplicate replay output.

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-09T05:43:01Z
- **Completed:** 2026-02-09T05:46:15Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `buildReviewOutputKey(...)` and `ensureReviewOutputNotPublished(...)` in `src/handlers/review-idempotency.ts` for deterministic keying and marker lookup.
- Wired review handler to compute one key per accepted event and short-circuit execution when output is already published.
- Extended execution context and MCP wiring so inline output checks/sets `kodiai:review-output-key` markers and logs `published` vs `already-published-skip` outcomes with `deliveryId`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deterministic review output keying and downstream idempotency guard** - `02f00e013d` (feat)
2. **Task 2: Enforce output idempotency in MCP inline review publication path** - `a26ac119e7` (feat)

**Plan metadata:** Pending

## Files Created/Modified

- `src/handlers/review-idempotency.ts` - deterministic key builder, marker builder, and pre-publication lookup guard.
- `src/handlers/review.ts` - key generation, handler-level idempotency gate, executor context propagation.
- `src/execution/types.ts` - `reviewOutputKey` and `deliveryId` on execution context.
- `src/execution/executor.ts` - forwards idempotency context into MCP server construction.
- `src/execution/mcp/index.ts` - plumbs output key/delivery/logger into inline review server.
- `src/execution/mcp/inline-review-server.ts` - marker skip guard, marker stamping, and publication outcome logging.
- `src/handlers/review.test.ts` - updated review fixture to include head SHA for deterministic key inputs.

## Decisions Made

- Used a deterministic composite key (installation, owner/repo, PR number, action, delivery ID, head SHA) so one accepted delivery maps to one review output identity.
- Added guard checks both at handler entry and inside inline publication to cover ingress dedup misses and replay/retry paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Handle missing head SHA in malformed/test payloads**
- **Found during:** Task 1
- **Issue:** Deterministic key generation assumed `pull_request.head.sha` was present; current test fixture omitted it and caused runtime failure.
- **Fix:** Added safe fallback (`unknown-head-sha`) in handler key construction and aligned fixture with explicit SHA.
- **Files modified:** `src/handlers/review.ts`, `src/handlers/review.test.ts`
- **Verification:** `bun test src/handlers/review.test.ts` passes (4/4).
- **Committed in:** `02f00e013d` (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix is correctness-hardening for malformed payload handling; no scope creep.

## Issues Encountered

- `bunx tsc --noEmit` currently fails on pre-existing unrelated files (`src/handlers/mention-types.ts`, `src/lib/sanitizer.test.ts`) and is not introduced by this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `10-04-PLAN.md` regression coverage and replay validation.
- Downstream output path now has deterministic keying and skip semantics needed for duplicate/retry tests.

## Self-Check: PASSED

- FOUND: `.planning/phases/10-review-request-reliability/10-03-SUMMARY.md`
- FOUND: commit `02f00e013d`
- FOUND: commit `a26ac119e7`
