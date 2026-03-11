# T01: 12-fork-pr-robustness 01

**Slice:** S02 — **Milestone:** M002

## Description

Make fork PR reviews robust by cloning the base repo and fetching PR head refs, rather than cloning the fork directly.

Purpose: Ensure xbmc/xbmc external contributor PRs are reliably reviewable under GitHub App token constraints.
Output: Updated review workspace strategy + tests.

## Must-Haves

- [ ] "Fork PR reviews do not rely on cloning the contributor's fork"
- [ ] "Review workspace is built by cloning base repo and fetching pull/<n>/head"
- [ ] "Inline review comments still anchor correctly"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/jobs/workspace.ts`
