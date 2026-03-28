---
id: T02
parent: S03
milestone: M030
provides: []
requires: []
affects: []
key_files: ["src/handlers/addon-check.ts", "src/handlers/addon-check.test.ts", "Dockerfile"]
key_decisions: ["toolNotFound detection requires subprocess to throw with code=ENOENT; exitCode:127 takes the success branch", "upsertAddonCheckComment is unexported inline helper with typed octokit slice", "__fetchAndCheckoutForTests injection mirrors __runSubprocessForTests pattern"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/handlers/addon-check.test.ts — 15 pass, 0 fail. bun run tsc --noEmit — exit 0."
completed_at: 2026-03-28T16:20:47.751Z
blocker_discovered: false
---

# T02: Wired fork detection, idempotent PR comment upsert, and python3/kodi-addon-checker Dockerfile into addon-check handler — 15/15 tests pass, tsc clean

> Wired fork detection, idempotent PR comment upsert, and python3/kodi-addon-checker Dockerfile into addon-check handler — 15/15 tests pass, tsc clean

## What Happened
---
id: T02
parent: S03
milestone: M030
key_files:
  - src/handlers/addon-check.ts
  - src/handlers/addon-check.test.ts
  - Dockerfile
key_decisions:
  - toolNotFound detection requires subprocess to throw with code=ENOENT; exitCode:127 takes the success branch
  - upsertAddonCheckComment is unexported inline helper with typed octokit slice
  - __fetchAndCheckoutForTests injection mirrors __runSubprocessForTests pattern
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:20:47.751Z
blocker_discovered: false
---

# T02: Wired fork detection, idempotent PR comment upsert, and python3/kodi-addon-checker Dockerfile into addon-check handler — 15/15 tests pass, tsc clean

**Wired fork detection, idempotent PR comment upsert, and python3/kodi-addon-checker Dockerfile into addon-check handler — 15/15 tests pass, tsc clean**

## What Happened

Updated src/handlers/addon-check.ts with fork detection (isFork/isDeletedFork from head.repo), an unexported upsertAddonCheckComment helper that list/create/updates PR comments using the marker for idempotency, toolNotFoundCount guard to skip comment when checker is missing, and __fetchAndCheckoutForTests injection point for testability. Updated Dockerfile with python3+pip+kodi-addon-checker. Extended test file with createMockOctokitWithIssues helper and 4 new tests covering posts-comment, no-comment-on-toolNotFound, upsert path, and fork PR path.

## Verification

bun test src/handlers/addon-check.test.ts — 15 pass, 0 fail. bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/handlers/addon-check.test.ts` | 0 | ✅ pass | 4200ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6300ms |


## Deviations

toolNotFound test stub throws ENOENT instead of returning exitCode:127 — the plan implied exitCode:127 but runAddonChecker detects toolNotFound via caught ENOENT error, not exit code.

## Known Issues

None.

## Files Created/Modified

- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`
- `Dockerfile`


## Deviations
toolNotFound test stub throws ENOENT instead of returning exitCode:127 — the plan implied exitCode:127 but runAddonChecker detects toolNotFound via caught ENOENT error, not exit code.

## Known Issues
None.
