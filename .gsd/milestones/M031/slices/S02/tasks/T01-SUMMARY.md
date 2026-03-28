---
id: T01
parent: S02
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/jobs/types.ts", "src/jobs/workspace.ts"]
key_decisions: ["Strip happens immediately after clone+upstream-add so .git/config is clean for the entire workspace lifetime", "token field is optional (token?) for backward compat with existing { dir, cleanup } literal constructions in tests"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bunx tsc --noEmit: 0 errors. bun test src/jobs/workspace.test.ts: 9/9 pass."
completed_at: 2026-03-28T16:57:15.612Z
blocker_discovered: false
---

# T01: Added Workspace.token field and stripped installation tokens from git remotes immediately after cloning

> Added Workspace.token field and stripped installation tokens from git remotes immediately after cloning

## What Happened
---
id: T01
parent: S02
milestone: M031
key_files:
  - src/jobs/types.ts
  - src/jobs/workspace.ts
key_decisions:
  - Strip happens immediately after clone+upstream-add so .git/config is clean for the entire workspace lifetime
  - token field is optional (token?) for backward compat with existing { dir, cleanup } literal constructions in tests
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:57:15.612Z
blocker_discovered: false
---

# T01: Added Workspace.token field and stripped installation tokens from git remotes immediately after cloning

**Added Workspace.token field and stripped installation tokens from git remotes immediately after cloning**

## What Happened

Added `token?: string` to the Workspace interface in types.ts. In workspace.ts createWorkspaceManager().create(), added git remote set-url calls immediately after the clone block for both paths: standard clone strips origin, fork clone strips both origin and upstream. Updated return to include token. Token is now memory-only; .git/config contains bare HTTPS URLs for the entire workspace lifetime.

## Verification

bunx tsc --noEmit: 0 errors. bun test src/jobs/workspace.test.ts: 9/9 pass.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bunx tsc --noEmit && echo 'types ok'` | 0 | ✅ pass | 6100ms |
| 2 | `bun test src/jobs/workspace.test.ts` | 0 | ✅ pass | 2300ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/types.ts`
- `src/jobs/workspace.ts`


## Deviations
None.

## Known Issues
None.
