---
phase: 107-duplicate-detection-auto-triage
plan: 02
subsystem: handlers
tags: [webhook, idempotency, octokit, postgres]

requires:
  - phase: 107-duplicate-detection-auto-triage
    provides: findDuplicateCandidates, formatTriageComment, buildTriageMarker, config schema, triage state table
provides:
  - createIssueOpenedHandler factory registered on issues.opened
  - Three-layer idempotency for auto-triage
  - Handler wired in src/index.ts with dependency guards
affects: [auto-triage, duplicate-detection]

tech-stack:
  added: []
  patterns: [three-layer-idempotency, config-gated-handler]

key-files:
  created:
    - src/handlers/issue-opened.ts
    - src/handlers/issue-opened.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "Use workspaceManager for config loading (consistent with review/mention handlers)"
  - "Comment marker scan before DB claim (Layer 3 before Layer 2) for cheapest check first"

patterns-established:
  - "Three-layer idempotency: delivery-ID dedup + atomic DB claim + comment marker scan"
  - "Config-gated handler: registration always happens, config check inside handler"

requirements-completed: [TRIAGE-01, TRIAGE-02, TRIAGE-03, TRIAGE-04]

duration: 8min
completed: 2026-02-27
---

# Plan 107-02 Summary

**Issue-opened handler with three-layer idempotency, config gating, and bootstrap registration for auto-triage on issues.opened**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 1

## Accomplishments
- Created createIssueOpenedHandler factory with full handler flow
- Implemented three-layer idempotency: delivery-ID dedup (existing), atomic DB INSERT claim, comment marker scan fallback
- Config-gated behind triage.enabled and autoTriageOnOpen (default false)
- Handler posts triage comment only when candidates found (zero noise)
- Label application with fail-open error handling
- Registered in src/index.ts with issueStore + embeddingProvider guards
- 9 unit tests covering all code paths

## Task Commits

1. **Task 1: Implement issue-opened handler with idempotency and tests** - `63ae592d4a` (feat)
2. **Task 2: Register handler in application bootstrap** - `f64d63891d` (feat)

## Files Created/Modified
- `src/handlers/issue-opened.ts` - Handler factory with three-layer idempotency
- `src/handlers/issue-opened.test.ts` - 9 tests covering all code paths
- `src/index.ts` - Handler registration with dependency guards

## Decisions Made
- Used workspaceManager for config loading (shallow clone + loadRepoConfig) for consistency with existing handlers
- Comment marker scan happens before DB claim to use the cheapest idempotency check first

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 107 complete: duplicate detection and auto-triage fully operational
- Ready for Phase 108 (PR-Issue Linking) and Phase 109 (Retrieval Integration)

---
*Phase: 107-duplicate-detection-auto-triage*
*Completed: 2026-02-27*
