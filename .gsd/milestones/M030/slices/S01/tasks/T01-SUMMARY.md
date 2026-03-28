---
id: T01
parent: S01
milestone: M030
provides: []
requires: []
affects: []
key_files: ["src/config.ts", "src/handlers/addon-check.ts", "src/handlers/addon-check.test.ts"]
key_decisions: ["Used same child-logger pattern as issue-opened.ts (handler, repo, prNumber, deliveryId bindings)", "Root-level file exclusion uses includes('/') guard — simple and correct for all POSIX paths", "Test mock overrides child() to funnel child-logger info calls into shared infoCalls array for structured binding assertions"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/handlers/addon-check.test.ts — all 5 tests passed (3.2s)"
completed_at: 2026-03-28T15:23:59.783Z
blocker_discovered: false
---

# T01: Added addonRepos to AppConfig, created the addon-check handler scaffold, and verified all 5 unit test scenarios pass

> Added addonRepos to AppConfig, created the addon-check handler scaffold, and verified all 5 unit test scenarios pass

## What Happened
---
id: T01
parent: S01
milestone: M030
key_files:
  - src/config.ts
  - src/handlers/addon-check.ts
  - src/handlers/addon-check.test.ts
key_decisions:
  - Used same child-logger pattern as issue-opened.ts (handler, repo, prNumber, deliveryId bindings)
  - Root-level file exclusion uses includes('/') guard — simple and correct for all POSIX paths
  - Test mock overrides child() to funnel child-logger info calls into shared infoCalls array for structured binding assertions
duration: ""
verification_result: passed
completed_at: 2026-03-28T15:23:59.783Z
blocker_discovered: false
---

# T01: Added addonRepos to AppConfig, created the addon-check handler scaffold, and verified all 5 unit test scenarios pass

**Added addonRepos to AppConfig, created the addon-check handler scaffold, and verified all 5 unit test scenarios pass**

## What Happened

Added addonRepos to the Zod schema in src/config.ts with a comma-split transform and default of xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers. Created src/handlers/addon-check.ts following the createIssueOpenedHandler factory pattern: registers on both pull_request.opened and pull_request.synchronize, gates on config.addonRepos.includes(repo), calls octokit.rest.pulls.listFiles, extracts first path segments from files containing a slash, deduplicates and sorts, logs addon IDs at info level with structured bindings. Created src/handlers/addon-check.test.ts with 5 test cases covering registration, non-addon repo skip, correct ID extraction, empty PR, and root-level file exclusion.

## Verification

bun test src/handlers/addon-check.test.ts — all 5 tests passed (3.2s)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/handlers/addon-check.test.ts` | 0 | ✅ pass | 3200ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/config.ts`
- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`


## Deviations
None.

## Known Issues
None.
