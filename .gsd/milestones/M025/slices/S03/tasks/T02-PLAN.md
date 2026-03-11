# T02: 122-enhanced-staleness 02

**Slice:** S03 — **Milestone:** M025

## Description

Wire the PR-based pipeline into the live staleness detector, replacing commit-based scanning with merged-PR scanning. Update the heuristic pass to store evidence for matched files, enhance LLM evaluation with actual diff content, and create the 90-day backfill script.

Purpose: This plan completes the Phase 122 transition from commit-based to PR-based staleness detection. After this plan, the weekly scanner fetches merged PRs, stores patch evidence for matched wiki pages, and the LLM evaluator can see actual code diffs instead of just file names. The backfill script populates the initial 90-day evidence window.

Output: Fully wired PR-based staleness pipeline, updated types, updated tests, and backfill script.

## Must-Haves

- [ ] "The staleness detector runScan uses fetchMergedPRs instead of fetchChangedFiles -- PRs are the source of change data, not individual commits"
- [ ] "heuristicPass receives MergedPR data and matches PR changed files to wiki pages, storing only matching patches via storePREvidence"
- [ ] "evaluateWithLlm includes actual diff content (patch hunks) in the LLM prompt alongside file paths, enabling grounded staleness assessment"
- [ ] "Run state tracks the last merged PR's merged_at timestamp as the scan window cursor instead of commit SHA"
- [ ] "The backfill script scans 90 days of merged PRs, runs heuristic matching, and stores evidence for the initial population"
- [ ] "StalePage type includes prNumber for downstream Phase 123 citation"
- [ ] "WikiPageCandidate tracks affectingPRNumbers instead of (or alongside) affectingCommitShas"

## Files

- `src/knowledge/wiki-staleness-detector.ts`
- `src/knowledge/wiki-staleness-types.ts`
- `src/knowledge/wiki-staleness-detector.test.ts`
- `scripts/backfill-pr-evidence.ts`
