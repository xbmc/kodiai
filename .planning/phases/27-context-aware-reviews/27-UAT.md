---
status: diagnosed
phase: 27-context-aware-reviews
source: 27-01-SUMMARY.md, 27-02-SUMMARY.md
started: 2026-02-12T02:10:00Z
updated: 2026-02-12T02:47:00Z
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
  root_cause: "Shallow workspace clone lacks merge base for origin/main...HEAD triple-dot diff, causing git exit 128 before path instruction matching runs."
  artifacts:
    - path: "src/handlers/review.ts:458"
      issue: "Changed-file and diff collection uses origin/base...HEAD in shallow clone; can fail with no merge base"
    - path: "src/handlers/review.ts:497"
      issue: "Path-instruction matching runs after diff collection and is skipped when diff command fails"
    - path: "src/jobs/workspace.ts:548"
      issue: "Workspace clone uses shallow history depth, enabling merge-base absence"
  missing:
    - "Ensure merge base availability before triple-dot diff (adaptive deepen/fetch ancestry)"
    - "Or use diff strategy for changed-file extraction that does not require merge base in shallow clones"
  debug_session: ".planning/debug/pr38-exit-128-path-instruct.md"
