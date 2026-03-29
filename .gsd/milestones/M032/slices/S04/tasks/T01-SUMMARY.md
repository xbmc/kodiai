---
id: T01
parent: S04
milestone: M032
provides: []
requires: []
affects: []
key_files: ["scripts/verify-m032.ts", "scripts/verify-m032.test.ts", "package.json"]
key_decisions: ["Workspace check skips gracefully on EACCES/ENOENT (Azure Files mount absent in dev/CI), matching M029 infra-gated check pattern — skipped checks excluded from overallPassed so CLI exits 0 on dev machines"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test ./scripts/verify-m032.test.ts → 19/19 pass. bun run verify:m032 → exits 0 (two PASS, one SKIP for workspace mount in dev). bun run tsc --noEmit → exits 0. bash -n deploy.sh → exits 0."
completed_at: 2026-03-29T19:25:51.958Z
blocker_discovered: false
---

# T01: Add scripts/verify-m032.ts proof harness with 3 security checks, 19 passing tests, and package.json entry; bun run verify:m032 exits 0, tsc --noEmit exits 0

> Add scripts/verify-m032.ts proof harness with 3 security checks, 19 passing tests, and package.json entry; bun run verify:m032 exits 0, tsc --noEmit exits 0

## What Happened
---
id: T01
parent: S04
milestone: M032
key_files:
  - scripts/verify-m032.ts
  - scripts/verify-m032.test.ts
  - package.json
key_decisions:
  - Workspace check skips gracefully on EACCES/ENOENT (Azure Files mount absent in dev/CI), matching M029 infra-gated check pattern — skipped checks excluded from overallPassed so CLI exits 0 on dev machines
duration: ""
verification_result: passed
completed_at: 2026-03-29T19:25:51.959Z
blocker_discovered: false
---

# T01: Add scripts/verify-m032.ts proof harness with 3 security checks, 19 passing tests, and package.json entry; bun run verify:m032 exits 0, tsc --noEmit exits 0

**Add scripts/verify-m032.ts proof harness with 3 security checks, 19 passing tests, and package.json entry; bun run verify:m032 exits 0, tsc --noEmit exits 0**

## What Happened

Created scripts/verify-m032.ts following the verify-m031.ts pattern with 3 pure-code checks: JOB-SPEC-NO-SECRETS (asserts APPLICATION_SECRET_NAMES absent from buildAcaJobSpec env array), MCP-AUTH-REJECTS-UNAUTH (asserts 401 from createMcpHttpRoutes with empty registry), and WORKSPACE-ON-AZURE-FILES (asserts returned path starts with mountBase, skips gracefully when Azure Files mount absent). Created 19-test verify-m032.test.ts with pass/fail injection paths per check and full harness envelope tests. Added verify:m032 script to package.json.

## Verification

bun test ./scripts/verify-m032.test.ts → 19/19 pass. bun run verify:m032 → exits 0 (two PASS, one SKIP for workspace mount in dev). bun run tsc --noEmit → exits 0. bash -n deploy.sh → exits 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m032.test.ts` | 0 | ✅ pass | 1800ms |
| 2 | `bun run verify:m032` | 0 | ✅ pass | 3200ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 8800ms |
| 4 | `bash -n deploy.sh` | 0 | ✅ pass | 100ms |


## Deviations

Workspace check returns skipped:true instead of failing when Azure Files mount absent (EACCES/ENOENT). Matches M029 infra-gated check pattern. Keeps CLI exit 0 in dev without hiding the contract — the skip message documents what would be proven on the orchestrator.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m032.ts`
- `scripts/verify-m032.test.ts`
- `package.json`


## Deviations
Workspace check returns skipped:true instead of failing when Azure Files mount absent (EACCES/ENOENT). Matches M029 infra-gated check pattern. Keeps CLI exit 0 in dev without hiding the contract — the skip message documents what would be proven on the orchestrator.

## Known Issues
None.
