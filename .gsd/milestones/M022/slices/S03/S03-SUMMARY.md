---
id: S03
parent: M022
milestone: M022
provides:
  - issue-reference-parser
  - issue-linker
  - linked-issue-review-context
requires: []
affects: []
key_files: []
key_decisions:
  - [object Object]
  - [object Object]
  - [object Object]
  - [object Object]
  - [object Object]
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 3 min
verification_result: passed
completed_at: 2026-02-27
blocker_discovered: false
---
# S03: Pr Issue Linking

**# Phase 108 Plan 01: Issue Reference Parser + Issue Linker Summary**

## What Happened

# Phase 108 Plan 01: Issue Reference Parser + Issue Linker Summary

Pure regex-based issue reference parser extracting fixes/closes/resolves/relates-to keywords from PR body and commit messages, plus orchestrator module resolving parsed references against the issue corpus with semantic search fallback at 0.80 similarity threshold.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Issue reference parser with tests | 9299dc6335 | 2 created |
| 2 | Issue linker orchestrator with tests | 9299dc6335 | 2 created |

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## Key Artifacts

- `parseIssueReferences()`: Pure function extracting issue refs from PR body + commit messages
- `linkPRToIssues()`: Orchestrator resolving refs to corpus records with semantic fallback
- 44 tests covering all parsing variants, linker behavior, and fail-open paths

## Next

Ready for Plan 02: Review pipeline wiring.

# Phase 108 Plan 02: Review Pipeline Wiring Summary

Extended buildReviewPrompt with linkedIssues parameter and buildLinkedIssuesSection formatter. Wired linkPRToIssues call into review handler before prompt building with fail-open error handling. Injected issueStore into review handler deps from index.ts.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add linked issues section to buildReviewPrompt | 79d2e9d95e | 1 modified |
| 2 | Wire issue linking into review handler + index.ts | 79d2e9d95e | 2 modified |

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## Key Artifacts

- `buildLinkedIssuesSection()`: Formats Referenced Issues and Possibly Related Issues sections
- Review handler calls `linkPRToIssues` with fail-open wrapping
- Both standard and retry review prompts include linked issue context
- `issueStore` injected via `createReviewHandler` deps from `index.ts`

## Next

Phase 108 complete, ready for verification.
