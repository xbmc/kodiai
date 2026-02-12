---
status: complete
phase: 27-context-aware-reviews
source: 27-01-SUMMARY.md, 27-02-SUMMARY.md
started: 2026-02-12T02:10:00Z
updated: 2026-02-12T02:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Path-Scoped Instructions Apply by Directory
expected: With `review.pathInstructions` configured for different paths (for example `src/api/**` vs `docs/**`), a PR that changes both areas gets review feedback that reflects the matched path rules, and non-matching rules are not applied.
result: issue
reported: "User reported: verify it for me, make a PR in xbmc/kodiai, etc. Live verification PR #38 posted, but Kodiai responded: Failed with exit code 128."
severity: blocker

### 2. Profile Preset Controls Strictness Bundle
expected: Setting `review.profile` to `strict`, `balanced`, or `minimal` changes review behavior as a bundle (severity threshold, focus behavior, and comment volume), with visible differences in findings across the same PR.
result: skipped
reason: Blocked by reviewer execution failure on PR #38 (exit code 128)

### 3. Diff Risk Signals Influence Review Focus
expected: For a PR that includes high-risk changes (for example auth logic or new dependencies), review feedback prioritizes those risk areas and surfaces findings aligned to those changes.
result: skipped
reason: Blocked by reviewer execution failure on PR #38 (exit code 128)

### 4. Backward Compatibility Without New Config
expected: Without new Phase 27 fields in `.kodiai.yml`, review still runs successfully with prior behavior and no regression in review flow.
result: skipped
reason: Blocked by reviewer execution failure on PR #38 (exit code 128)

## Summary

total: 4
passed: 0
issues: 1
pending: 0
skipped: 3

## Gaps

- truth: "Path-scoped instructions are applied during a live PR review in xbmc/kodiai"
  status: failed
  reason: "User reported: verify it for me, make a PR in xbmc/kodiai, etc. Live verification PR #38 posted, but Kodiai responded: Failed with exit code 128."
  severity: blocker
  test: 1
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
