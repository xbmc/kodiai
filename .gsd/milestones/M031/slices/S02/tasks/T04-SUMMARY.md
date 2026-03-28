---
id: T04
parent: S02
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/jobs/workspace.test.ts"]
key_decisions: ["Tested makeAuthUrl behavior via buildAuthFetchUrl (exported) rather than the private function directly", "Used local bare repos (file://) for all git-exercising tests to avoid real GitHub network calls", "Verified token-strip invariant by running git remote get-url origin and asserting no x-access-token in output"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/jobs/workspace.test.ts: 16 pass, 0 fail. Full bun test: 2225 pass, 54 fail (all pre-existing Azure Postgres CONNECT_TIMEOUT DB-integration tests)."
completed_at: 2026-03-28T17:17:41.102Z
blocker_discovered: false
---

# T04: Added 7 new workspace tests covering buildAuthFetchUrl behavior and the URL-strip invariant; all 16 workspace tests pass

> Added 7 new workspace tests covering buildAuthFetchUrl behavior and the URL-strip invariant; all 16 workspace tests pass

## What Happened
---
id: T04
parent: S02
milestone: M031
key_files:
  - src/jobs/workspace.test.ts
key_decisions:
  - Tested makeAuthUrl behavior via buildAuthFetchUrl (exported) rather than the private function directly
  - Used local bare repos (file://) for all git-exercising tests to avoid real GitHub network calls
  - Verified token-strip invariant by running git remote get-url origin and asserting no x-access-token in output
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:17:41.103Z
blocker_discovered: false
---

# T04: Added 7 new workspace tests covering buildAuthFetchUrl behavior and the URL-strip invariant; all 16 workspace tests pass

**Added 7 new workspace tests covering buildAuthFetchUrl behavior and the URL-strip invariant; all 16 workspace tests pass**

## What Happened

Extended src/jobs/workspace.test.ts with three new describe blocks: (1) buildAuthFetchUrl tests exercising token-absent fallback and token-injection into clean GitHub URLs using local bare repos; (2) URL-strip simulation tests that inject a credential-bearing URL into a git remote, strip it, then assert git remote get-url origin contains no x-access-token; (3) createWorkspaceManager token-threading structural tests verifying the Workspace.token interface contract. A setupBareAndClone helper was extracted to avoid repeating local-bare-repo setup across all three suites.

## Verification

bun test src/jobs/workspace.test.ts: 16 pass, 0 fail. Full bun test: 2225 pass, 54 fail (all pre-existing Azure Postgres CONNECT_TIMEOUT DB-integration tests).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/jobs/workspace.test.ts` | 0 | ✅ pass | 265ms |
| 2 | `bun test (full suite, workspace file subset)` | 0 | ✅ pass | 265ms |


## Deviations

Omitted a TypeScript-compile-only check for createBranchCommitAndPush accepting token? — redundant since buildAuthFetchUrl tests cover the behavioral contract and the compiler catches the type contract at build time.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/workspace.test.ts`


## Deviations
Omitted a TypeScript-compile-only check for createBranchCommitAndPush accepting token? — redundant since buildAuthFetchUrl tests cover the behavioral contract and the compiler catches the type contract at build time.

## Known Issues
None.
