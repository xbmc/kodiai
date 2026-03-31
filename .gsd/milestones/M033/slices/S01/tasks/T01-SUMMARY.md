---
id: T01
parent: S01
milestone: M033
provides: []
requires: []
affects: []
key_files: ["src/jobs/aca-launcher.ts", "src/jobs/aca-launcher.test.ts", "src/execution/executor.ts", "src/execution/executor.test.ts"]
key_decisions: ["GITHUB_INSTALLATION_TOKEN is now a permanently forbidden key in APPLICATION_SECRET_NAMES rather than an optional opt-in — the agent container must acquire its own installation token independently"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/jobs/aca-launcher.test.ts: 21 pass, 0 fail. bun run tsc --noEmit: exit 0."
completed_at: 2026-03-31T11:37:05.865Z
blocker_discovered: false
---

# T01: Added GITHUB_INSTALLATION_TOKEN to APPLICATION_SECRET_NAMES, removed it from BuildAcaJobSpecOpts/buildAcaJobSpec, and dropped the dead getInstallationToken call from executor.ts

> Added GITHUB_INSTALLATION_TOKEN to APPLICATION_SECRET_NAMES, removed it from BuildAcaJobSpecOpts/buildAcaJobSpec, and dropped the dead getInstallationToken call from executor.ts

## What Happened
---
id: T01
parent: S01
milestone: M033
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/execution/executor.ts
  - src/execution/executor.test.ts
key_decisions:
  - GITHUB_INSTALLATION_TOKEN is now a permanently forbidden key in APPLICATION_SECRET_NAMES rather than an optional opt-in — the agent container must acquire its own installation token independently
duration: ""
verification_result: passed
completed_at: 2026-03-31T11:37:05.865Z
blocker_discovered: false
---

# T01: Added GITHUB_INSTALLATION_TOKEN to APPLICATION_SECRET_NAMES, removed it from BuildAcaJobSpecOpts/buildAcaJobSpec, and dropped the dead getInstallationToken call from executor.ts

**Added GITHUB_INSTALLATION_TOKEN to APPLICATION_SECRET_NAMES, removed it from BuildAcaJobSpecOpts/buildAcaJobSpec, and dropped the dead getInstallationToken call from executor.ts**

## What Happened

Four tightly coupled mutations: (1) GITHUB_INSTALLATION_TOKEN added to APPLICATION_SECRET_NAMES in aca-launcher.ts, (2) githubInstallationToken field removed from BuildAcaJobSpecOpts and its conditional env push removed from buildAcaJobSpec(), (3) githubInstallationToken prop and getInstallationToken() call removed from the buildAcaJobSpec invocation in executor.ts, (4) aca-launcher.test.ts updated with new assertions matching the contract. An unplanned fifth file, executor.test.ts, also had the same prop in a stub call that was caught by tsc --noEmit and removed.

## Verification

bun test ./src/jobs/aca-launcher.test.ts: 21 pass, 0 fail. bun run tsc --noEmit: exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/aca-launcher.test.ts` | 0 | ✅ pass | 226ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6200ms |


## Deviations

executor.test.ts also required the same githubInstallationToken removal (not listed in task plan inputs) — minor addition, same intent.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `src/execution/executor.ts`
- `src/execution/executor.test.ts`


## Deviations
executor.test.ts also required the same githubInstallationToken removal (not listed in task plan inputs) — minor addition, same intent.

## Known Issues
None.
