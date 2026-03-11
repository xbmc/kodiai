# T03: 27-context-aware-reviews 03

**Slice:** S02 — **Milestone:** M004

## Description

Close the Phase 27 UAT blocker by making review diff collection resilient in shallow workspaces where `origin/base...HEAD` has no merge base.

Purpose: Restore live review execution so path instructions and diff context can run on real PRs instead of failing early with exit code 128.
Output: Hardened review handler diff strategy with regression tests proving no-merge-base scenarios still reach prompt enrichment.

## Must-Haves

- [ ] "Live PR review no longer fails with git exit 128 when shallow clone history lacks a merge base"
- [ ] "Changed-file extraction for path instruction matching still runs and produces a deterministic file list"
- [ ] "Diff analysis context (numstat/full diff) remains available or degrades gracefully with explicit logs"
- [ ] "Path-scoped instructions can be applied on the same PR shape that previously failed (#38-like shallow ancestry)"
- [ ] "Backward compatibility remains: repositories without Phase 27 config still complete review flow"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
