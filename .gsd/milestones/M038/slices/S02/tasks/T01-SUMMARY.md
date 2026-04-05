---
id: T01
parent: S02
milestone: M038
key_files:
  - src/lib/structural-impact-formatter.ts
  - src/lib/structural-impact-formatter.test.ts
  - src/lib/review-utils.ts
  - .gsd/milestones/M038/slices/S02/tasks/T01-SUMMARY.md
key_decisions:
  - Used hard per-list caps plus explicit shown/total/truncated metadata for Review Details structural output instead of an unstructured dump or single opaque char budget.
  - Reserved stronger graph evidence wording for full-confidence edges and used probable graph evidence language for all lower-confidence graph results.
duration: 
verification_result: passed
completed_at: 2026-04-05T19:24:23.380Z
blocker_discovered: false
---

# T01: Added a bounded Structural Impact formatter for Review Details with truthful confidence wording, truncation metadata, and focused formatter tests.

**Added a bounded Structural Impact formatter for Review Details with truthful confidence wording, truncation metadata, and focused formatter tests.**

## What Happened

Created src/lib/structural-impact-formatter.ts to render bounded StructuralImpactPayload data into a dedicated Review Details subsection covering changed symbols, graph coverage, probable callers/dependents, impacted files, likely tests, and unchanged-code evidence. The formatter uses hard per-list caps and explicit shown/total/truncated metadata so large blast-radius payloads stay bounded. Confidence wording is intentionally truthful: graph entries render as either stronger graph evidence for full-confidence edges or probable graph evidence otherwise, and partial payloads downgrade the overall evidence line instead of overstating certainty. Added src/lib/structural-impact-formatter.test.ts with coverage for unavailable payloads, bounded rendering, truncation, hard-cap enforcement, truthful confidence wording, and partial-evidence behavior. Updated src/lib/review-utils.ts so formatReviewDetailsSummary() accepts an optional structuralImpact payload, injects the formatted section when present, and emits a machine-usable rendered-count line for callers/files/tests/unchanged evidence. During verification, TypeScript surfaced local wiring mistakes in review-utils.ts; I repaired the stale import/signature state and removed duplicated trailing text, then reran the exact verification command until it passed cleanly.

## Verification

Ran the task-plan verification command exactly as specified: bun test ./src/lib/structural-impact-formatter.test.ts && bun run tsc --noEmit. The formatter tests passed 8/8, and the repository typecheck completed cleanly after repairing the local review-utils.ts wiring regressions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/structural-impact-formatter.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 10ms |

## Deviations

None.

## Known Issues

This task only formats and exposes Structural Impact data inside Review Details. It does not yet wire the payload into the main review flow or strengthen breaking-change wording from structural evidence; that remains for S02/T02.

## Files Created/Modified

- `src/lib/structural-impact-formatter.ts`
- `src/lib/structural-impact-formatter.test.ts`
- `src/lib/review-utils.ts`
- `.gsd/milestones/M038/slices/S02/tasks/T01-SUMMARY.md`
