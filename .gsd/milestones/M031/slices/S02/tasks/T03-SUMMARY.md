---
id: T03
parent: S02
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/jobs/workspace.ts", "src/handlers/mention.ts", "src/handlers/review.ts", "src/slack/write-runner.ts"]
key_decisions: ["Exported buildAuthFetchUrl from workspace.ts rather than duplicating remote-URL-read+inject logic at each fetch site; returns 'origin' when token absent for backward compat", "collectDiffContext computes fetchRemote once before the deepen loop to avoid repeated git remote get-url calls per step"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bunx tsc --noEmit exits 0. bun test src/jobs/workspace.test.ts 9/9 pass. bun test src/handlers/mention.test.ts src/handlers/review.test.ts 159/159 pass."
completed_at: 2026-03-28T17:08:37.404Z
blocker_discovered: false
---

# T03: Wired workspace.token and forkContext.botPat through all push/fetch call sites in mention.ts, review.ts, and write-runner.ts via exported buildAuthFetchUrl helper

> Wired workspace.token and forkContext.botPat through all push/fetch call sites in mention.ts, review.ts, and write-runner.ts via exported buildAuthFetchUrl helper

## What Happened
---
id: T03
parent: S02
milestone: M031
key_files:
  - src/jobs/workspace.ts
  - src/handlers/mention.ts
  - src/handlers/review.ts
  - src/slack/write-runner.ts
key_decisions:
  - Exported buildAuthFetchUrl from workspace.ts rather than duplicating remote-URL-read+inject logic at each fetch site; returns 'origin' when token absent for backward compat
  - collectDiffContext computes fetchRemote once before the deepen loop to avoid repeated git remote get-url calls per step
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:08:37.404Z
blocker_discovered: false
---

# T03: Wired workspace.token and forkContext.botPat through all push/fetch call sites in mention.ts, review.ts, and write-runner.ts via exported buildAuthFetchUrl helper

**Wired workspace.token and forkContext.botPat through all push/fetch call sites in mention.ts, review.ts, and write-runner.ts via exported buildAuthFetchUrl helper**

## What Happened

Added exported buildAuthFetchUrl helper to workspace.ts that reads the stripped origin URL and injects a token, returning 'origin' when absent. Updated 8 call sites in mention.ts (fetchAndCheckoutPullRequestHeadRef, three inline fetch commands, commitAndPushToRemoteRef, pushHeadToRemoteRef, two createBranchCommitAndPush calls), 5 sites in review.ts (added token? to collectDiffContext params with a single fetchRemote computed once for all deepen iterations, fetchAndCheckoutPullRequestHeadRef twice, inline fetch twice, collectDiffContext invocation), and 2 sites in write-runner.ts (both commitBranchAndPush calls). No git network operation now reads credentials from .git/config.

## Verification

bunx tsc --noEmit exits 0. bun test src/jobs/workspace.test.ts 9/9 pass. bun test src/handlers/mention.test.ts src/handlers/review.test.ts 159/159 pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bunx tsc --noEmit` | 0 | ✅ pass | 7400ms |
| 2 | `bun test src/jobs/workspace.test.ts` | 0 | ✅ pass | 3000ms |
| 3 | `bun test src/handlers/mention.test.ts src/handlers/review.test.ts` | 0 | ✅ pass | 8100ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/review.ts`
- `src/slack/write-runner.ts`


## Deviations
None.

## Known Issues
None.
