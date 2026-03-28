---
id: T02
parent: S02
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/jobs/workspace.ts"]
key_decisions: ["push/fetch commands receive the auth URL as the remote argument (git push <url> HEAD:ref) rather than mutating remote config; URL is ephemeral", "getOriginTokenFromDir and getOriginTokenFromRemoteUrl retained but unused — noUnusedLocals:false, deletion deferred to cleanup pass"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bunx tsc --noEmit exits 0. bun test src/jobs/workspace.test.ts 9/9 pass."
completed_at: 2026-03-28T17:02:49.441Z
blocker_discovered: false
---

# T02: Added makeAuthUrl helper and refactored all four git network functions to accept explicit token? and construct auth URL inline instead of reading from remote config

> Added makeAuthUrl helper and refactored all four git network functions to accept explicit token? and construct auth URL inline instead of reading from remote config

## What Happened
---
id: T02
parent: S02
milestone: M031
key_files:
  - src/jobs/workspace.ts
key_decisions:
  - push/fetch commands receive the auth URL as the remote argument (git push <url> HEAD:ref) rather than mutating remote config; URL is ephemeral
  - getOriginTokenFromDir and getOriginTokenFromRemoteUrl retained but unused — noUnusedLocals:false, deletion deferred to cleanup pass
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:02:49.441Z
blocker_discovered: false
---

# T02: Added makeAuthUrl helper and refactored all four git network functions to accept explicit token? and construct auth URL inline instead of reading from remote config

**Added makeAuthUrl helper and refactored all four git network functions to accept explicit token? and construct auth URL inline instead of reading from remote config**

## What Happened

Added `makeAuthUrl(strippedUrl, token)` private helper that injects x-access-token credentials into a stripped HTTPS URL for a single command — returns the URL unchanged when token is undefined. Updated createBranchCommitAndPush, commitAndPushToRemoteRef, pushHeadToRemoteRef, and fetchAndCheckoutPullRequestHeadRef to (1) accept token? in options, (2) remove getOriginTokenFromDir/getOriginTokenFromRemoteUrl calls, (3) read the stripped remote URL with git remote get-url, apply makeAuthUrl, and pass the result directly as the remote argument to git push/fetch. The auth URL is ephemeral — constructed per-command, never stored. All existing call sites are backward-compatible since token? is optional.

## Verification

bunx tsc --noEmit exits 0. bun test src/jobs/workspace.test.ts 9/9 pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bunx tsc --noEmit && echo 'types ok'` | 0 | ✅ pass | 7600ms |
| 2 | `bun test src/jobs/workspace.test.ts` | 0 | ✅ pass | 5400ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/workspace.ts`


## Deviations
None.

## Known Issues
None.
