---
phase: 108-pr-issue-linking
plan: 02
subsystem: review-pipeline
tags: [issue-linking, review-prompt, wiring]
requires: [issue-reference-parser, issue-linker, issue-store]
provides: [linked-issue-review-context]
affects: [review-handler, review-prompt]
tech-stack:
  added: []
  patterns: [dep-injection, fail-open, optional-context]
key-files:
  created: []
  modified:
    - src/execution/review-prompt.ts
    - src/handlers/review.ts
    - src/index.ts
key-decisions:
  - decision: "Hoist commitMessages to wider scope for reuse by issue linker"
    rationale: "Avoids redundant API call to fetch commits a second time"
  - decision: "IssueStore is optional dep on createReviewHandler"
    rationale: "Backwards compatible -- review works without issue store"
requirements-completed:
  - PRLINK-03
duration: "3 min"
completed: "2026-02-27"
---

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
