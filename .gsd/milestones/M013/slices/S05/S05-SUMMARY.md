---
id: S05
parent: M013
milestone: M013
provides:
  - "Machine-checkable success-path status envelope with status: success, pr_url, issue_linkback_url"
  - "Regression coverage for dual-path (success + failure) status contract parity"
  - "Regression gate validates both success and failure status envelopes as machine-checkable contract paths"
  - "REL-74-05 check enforcing success reply includes pr_url and issue_linkback_url markers"
  - "Deterministic test coverage for success-path status contract regression"
requires: []
affects: []
key_files: []
key_decisions:
  - "Success envelope mirrors failure envelope structure with status: success plus pr_url and issue_linkback_url fields"
  - "Human-readable Opened PR: line retained alongside machine-checkable markers for backward compatibility"
  - "Gate parser extracts pr_url and issue_linkback_url markers from success replies alongside existing failure markers"
  - "REL-74-05 enforces machine-checkable URL markers are present in success status replies"
patterns_established:
  - "Issue write replies use buildIssueWriteSuccessReply/buildIssueWriteFailureReply builders for all terminal status paths"
  - "Success and failure paths share one status-envelope contract family validated by the same gate"
observability_surfaces: []
drill_down_paths: []
duration: 3min
verification_result: passed
completed_at: 2026-02-19
blocker_discovered: false
---
# S05: Success Path Status Contract Parity

**# Phase 76 Plan 01: Success Path Status Contract Parity Summary**

## What Happened

# Phase 76 Plan 01: Success Path Status Contract Parity Summary

**Issue write success replies now emit machine-checkable status: success envelope with pr_url and issue_linkback_url markers, locked by regression assertions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-19T19:04:14Z
- **Completed:** 2026-02-19T19:07:02Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added buildIssueWriteSuccessReply builder emitting deterministic status: success, pr_url, and issue_linkback_url markers
- Updated all success-path issue write tests to assert machine-checkable envelope markers
- Added negative regression test proving free-form-only replies lack required status markers
- Maintained failure-path assertions (status: pr_creation_failed) for dual-path contract parity

## Task Commits

Each task was committed atomically:

1. **Task 1: Emit deterministic success status envelope** - `4db1bfd89f` (feat)
2. **Task 2: Lock success-path status envelope with regression assertions** - `6bd808c09e` (test)

## Files Created/Modified
- `src/handlers/mention.ts` - Added buildIssueWriteSuccessReply builder and updated publish-path to use it
- `src/handlers/mention.test.ts` - Updated 7 success-path tests with status marker assertions, added negative regression test

## Decisions Made
- Success envelope mirrors failure envelope structure with status: success plus pr_url and issue_linkback_url fields
- Human-readable "Opened PR:" line retained alongside machine-checkable markers for backward compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Success and failure status envelopes are now contract-parity; downstream parsers can match both paths with `status: success|status: pr_creation_failed`
- Ready for 76-02 if additional contract hardening is needed

---
*Phase: 76-success-path-status-contract-parity*
*Completed: 2026-02-19*

# Phase 76 Plan 02: Consumer-Side Dual-Path Status Envelope Parity Summary

**Regression gate now validates success and failure status envelopes as one machine-checkable contract family with REL-74-05 check and deterministic test coverage**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-19T19:08:42Z
- **Completed:** 2026-02-19T19:11:19Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Extended gate parser to extract pr_url and issue_linkback_url markers from success replies
- Added REL-74-05 check enforcing success replies contain machine-checkable URL markers
- Added 7 new success-path regression tests covering parsing, pass/fail gate behavior, and marker absence
- Updated smoke and runbook docs to document shared dual-path status-envelope contract

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend gate parser and REL checks for dual-path parity** - `0261d9d9a9` (feat)
2. **Task 2: Add success-path status envelope regression tests** - `92cef21eae` (test)
3. **Task 3: Update smoke and runbook procedures** - `ec5f19ae42` (docs)

## Files Created/Modified
- `scripts/phase74-reliability-regression-gate.ts` - Added pr_url/issue_linkback_url parsing and REL-74-05 check
- `scripts/phase74-reliability-regression-gate.test.ts` - Added success scenario fixture and 7 new test cases
- `docs/smoke/phase74-reliability-regression-gate.md` - Added REL-74-05 to check inventory, success-path scenario example, updated evidence checklist
- `docs/runbooks/xbmc-ops.md` - Added dual-path contract preamble, REL-74-05 troubleshooting, updated escalation evidence

## Decisions Made
- Gate parser extracts pr_url and issue_linkback_url markers from success replies alongside existing failure markers
- REL-74-05 enforces machine-checkable URL markers are present in success status replies

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Regression gate, tests, and operator procedures now enforce one shared machine-checkable status contract for issue write success and failure paths
- Consumer parity complete; downstream consumers can match both paths with deterministic markers

---
*Phase: 76-success-path-status-contract-parity*
*Completed: 2026-02-19*
