---
id: T01
parent: S01
milestone: M032
provides: []
requires: []
affects: []
key_files: ["src/jobs/aca-launcher.ts", "src/jobs/aca-launcher.test.ts", "src/jobs/workspace.ts"]
key_decisions: ["launchAcaJob passes env vars as --env-vars KEY=VALUE pairs (az CLI convention)", "pollUntilComplete handles both properties.status and top-level status in az output for forward compatibility", "Runtime guard in buildAcaJobSpec throws at build time — fail-loud security contract"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./src/jobs/aca-launcher.test.ts → 16 pass, 0 fail (298ms). bun run tsc --noEmit → exit 0, no errors."
completed_at: 2026-03-29T18:23:16.727Z
blocker_discovered: false
---

# T01: Add ACA Job launcher module (spec builder, dispatch, poll, result reader) with APPLICATION_SECRET_NAMES security contract; 16/16 tests pass

> Add ACA Job launcher module (spec builder, dispatch, poll, result reader) with APPLICATION_SECRET_NAMES security contract; 16/16 tests pass

## What Happened
---
id: T01
parent: S01
milestone: M032
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/jobs/workspace.ts
key_decisions:
  - launchAcaJob passes env vars as --env-vars KEY=VALUE pairs (az CLI convention)
  - pollUntilComplete handles both properties.status and top-level status in az output for forward compatibility
  - Runtime guard in buildAcaJobSpec throws at build time — fail-loud security contract
duration: ""
verification_result: passed
completed_at: 2026-03-29T18:23:16.728Z
blocker_discovered: false
---

# T01: Add ACA Job launcher module (spec builder, dispatch, poll, result reader) with APPLICATION_SECRET_NAMES security contract; 16/16 tests pass

**Add ACA Job launcher module (spec builder, dispatch, poll, result reader) with APPLICATION_SECRET_NAMES security contract; 16/16 tests pass**

## What Happened

Created src/jobs/aca-launcher.ts with the full ACA Job infrastructure layer. The module exports APPLICATION_SECRET_NAMES (9 application secret key names that are forbidden from the job env array), buildAcaJobSpec (builds a minimal env with only ANTHROPIC_API_KEY/MCP_BEARER_TOKEN/WORKSPACE_DIR/GITHUB_INSTALLATION_TOKEN and throws if any forbidden names appear), launchAcaJob (runs az containerapp job execution start via Bun $), pollUntilComplete (polls az containerapp job execution show every 10s with timeout support), and readJobResult (reads and parses workspaceDir/result.json). Added createAzureFilesWorkspaceDir to workspace.ts. Wrote 16 tests covering the security contract, spec builder behavior, and result reader including negative tests for missing file and invalid JSON. tsc --noEmit is clean.

## Verification

bun test ./src/jobs/aca-launcher.test.ts → 16 pass, 0 fail (298ms). bun run tsc --noEmit → exit 0, no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/jobs/aca-launcher.test.ts` | 0 | ✅ pass | 298ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8100ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `src/jobs/workspace.ts`


## Deviations
None.

## Known Issues
None.
