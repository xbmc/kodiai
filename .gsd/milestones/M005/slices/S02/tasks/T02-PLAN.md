# T02: 31-incremental-re-review-with-retrieval-context 02

**Slice:** S02 — **Milestone:** M005

## Description

Create the incremental diff computation and finding deduplication utility modules.

Purpose: These are pure logic modules that determine (1) which files changed since the last reviewed head SHA and (2) which prior findings to suppress vs keep as context. They are stateless utilities consumed by the review handler in Plan 03.

Output: Two tested modules with clear type contracts.

## Must-Haves

- [ ] "computeIncrementalDiff returns mode=incremental with changed files when prior SHA is reachable"
- [ ] "computeIncrementalDiff returns mode=full with reason when prior SHA is unreachable or missing"
- [ ] "buildPriorFindingContext partitions findings into unchanged-code context vs suppression fingerprints"
- [ ] "Findings on changed files are NOT suppressed (treated as new)"
- [ ] "Findings on unchanged files generate suppression fingerprints"

## Files

- `src/lib/incremental-diff.ts`
- `src/lib/finding-dedup.ts`
- `src/lib/incremental-diff.test.ts`
- `src/lib/finding-dedup.test.ts`
