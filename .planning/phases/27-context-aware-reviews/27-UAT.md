---
status: complete
phase: 27-context-aware-reviews
source: 27-01-SUMMARY.md, 27-02-SUMMARY.md, 27-03-SUMMARY.md, 27-04-SUMMARY.md
started: 2026-02-12T04:11:04Z
updated: 2026-02-12T05:52:17Z
---

## Current Test

[testing complete]

## Tests

### 1. Path-Scoped Instructions Apply by Directory
expected: With `review.pathInstructions` configured for different paths (for example `src/api/**` vs `docs/**`), a PR that changes both areas completes review successfully and the feedback reflects only the matched path rules.
result: pass

### 2. Profile Preset Controls Strictness Bundle
expected: Setting `review.profile` to `strict`, `balanced`, or `minimal` changes review behavior as a bundle (severity threshold, focus behavior, and comment volume), with visible differences in findings across the same PR.
result: pass

### 3. Diff Risk Signals Influence Review Focus
expected: For a PR that includes high-risk changes (for example auth logic or new dependencies), review feedback prioritizes those risk areas and surfaces findings aligned to those changes.
result: pass

### 4. Backward Compatibility Without New Config
expected: Without new Phase 27 fields in `.kodiai.yml`, review still runs successfully with prior behavior and no regression in review flow.
result: pass

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
