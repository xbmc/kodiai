---
id: S01
parent: M033
milestone: M033
provides:
  - APPLICATION_SECRET_NAMES enforcement pattern for keys that must never reach the agent container
  - GITHUB_INSTALLATION_TOKEN permanently blocked from container env
requires:
  []
affects:
  []
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/execution/executor.ts
  - src/execution/executor.test.ts
key_decisions:
  - GITHUB_INSTALLATION_TOKEN is now a permanently blocked key in APPLICATION_SECRET_NAMES — the agent container must never receive it and must acquire its own token independently if needed (D019).
patterns_established:
  - APPLICATION_SECRET_NAMES is the single source of truth for keys that must never appear in the ACA job env array. Adding a key there triggers enforcement at three layers: (1) runtime throw in buildAcaJobSpec, (2) static type error if the field is passed via BuildAcaJobSpecOpts, (3) test assertions on the array contents and on env array absence.
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M033/slices/S01/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-31T11:38:40.616Z
blocker_discovered: false
---

# S01: Remove GITHUB_INSTALLATION_TOKEN from container env

**GITHUB_INSTALLATION_TOKEN moved to APPLICATION_SECRET_NAMES as a permanently blocked key; removed from BuildAcaJobSpecOpts, buildAcaJobSpec, and the executor.ts call site — the agent container never receives it.**

## What Happened

Single-task slice executing four tightly coupled mutations across three source files (plus one unplanned test file).

**aca-launcher.ts:** `"GITHUB_INSTALLATION_TOKEN"` appended to the `APPLICATION_SECRET_NAMES` readonly array, immediately after `"BOT_USER_PAT"`. The security guard in `buildAcaJobSpec` (`APPLICATION_SECRET_NAMES.includes(e.name)` throw) now covers this key at runtime, making injection impossible regardless of call site.

**BuildAcaJobSpecOpts interface:** `githubInstallationToken?: string` field removed. Any caller that previously passed the token will now get a TypeScript compile error, providing static enforcement.

**buildAcaJobSpec() body:** The conditional `if (opts.githubInstallationToken !== undefined)` env-push block removed. The function no longer has any path that would add the token to the container env array.

**executor.ts:** `githubInstallationToken: await githubApp.getInstallationToken(context.installationId)` removed from the `buildAcaJobSpec(...)` call. The `getInstallationToken()` call was the only consumer of that opt — dropping it removes the only site that fetched the token for container injection.

**executor.test.ts (unplanned):** The same property appeared in a buildAcaJobSpec stub call in executor.test.ts. TypeScript (`bun run tsc --noEmit`) caught it; it was removed in the same pass. Not in the task plan but same intent.

**aca-launcher.test.ts:** Three test updates:
1. `'contains the expected secret key names'` — added `'GITHUB_INSTALLATION_TOKEN'` to the expected array.
2. `'GITHUB_INSTALLATION_TOKEN is in APPLICATION_SECRET_NAMES'` — new explicit assertion replacing the now-invalid 'included when provided' test.
3. `'GITHUB_INSTALLATION_TOKEN always absent from spec env array'` — asserts it's always absent (unconditional, not opt-dependent).

Verification passed cleanly: 21/21 tests pass in aca-launcher.test.ts; `bun run tsc --noEmit` exits 0.

## Verification

bun test ./src/jobs/aca-launcher.test.ts: 21 pass, 0 fail (16ms). bun run tsc --noEmit: exit 0 (6.3s). Both gates verified by closer after task completion — results match task summary claims.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

executor.test.ts also required the same githubInstallationToken prop removal (not in the original task plan file list). TypeScript caught it; removal was trivial and same intent as the planned mutations.

## Known Limitations

None. The agent container genuinely never receives GITHUB_INSTALLATION_TOKEN — the APPLICATION_SECRET_NAMES runtime guard + static type removal + no call site = three independent enforcement layers.

## Follow-ups

None required. The agent container must acquire its own installation token independently if it ever needs one — the architectural decision (D019) is marked non-revisable.

## Files Created/Modified

- `src/jobs/aca-launcher.ts` — Added GITHUB_INSTALLATION_TOKEN to APPLICATION_SECRET_NAMES; removed githubInstallationToken from BuildAcaJobSpecOpts interface and conditional env-push from buildAcaJobSpec()
- `src/jobs/aca-launcher.test.ts` — Updated APPLICATION_SECRET_NAMES expected array, replaced 'included when provided' test with 'is in APPLICATION_SECRET_NAMES' test, updated 'always absent from spec env array' test
- `src/execution/executor.ts` — Removed githubInstallationToken prop and getInstallationToken() call from buildAcaJobSpec invocation
- `src/execution/executor.test.ts` — Removed githubInstallationToken prop from buildAcaJobSpec stub call (caught by tsc, unplanned but same intent)
