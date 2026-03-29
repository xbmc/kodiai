# S04: verify:m032 Proof Harness + Deploy Updates — UAT

**Milestone:** M032
**Written:** 2026-03-29T19:28:05.912Z

## Preconditions

- Node/Bun environment available (`bun --version` succeeds)
- Working directory: `/home/keith/src/kodiai`
- All prior slices (S01–S03) merged — `src/jobs/aca-launcher.ts`, `src/execution/mcp/http-server.ts`, `src/jobs/workspace.ts` present
- Azure Files share NOT mounted (dev machine) — WORKSPACE check expected to SKIP

---

## Test Cases

### TC-01: Test suite passes (19/19)

**Steps:**
1. `cd /home/keith/src/kodiai`
2. `bun test ./scripts/verify-m032.test.ts`

**Expected outcome:**
```
19 pass
0 fail
59 expect() calls
Ran 19 tests across 1 file.
```
Exit code: 0

---

### TC-02: CLI harness exits 0 in dev (2 PASS + 1 SKIP)

**Steps:**
1. `bun run verify:m032`

**Expected outcome:**
```
M032 proof harness
Final verdict: PASS
Checks:
- M032-JOB-SPEC-NO-SECRETS PASS status_code=job_spec_no_secrets env array contains no APPLICATION_SECRET_NAMES (env names: MCP_BEARER_TOKEN, MCP_BASE_URL, WORKSPACE_DIR)
- M032-MCP-AUTH-REJECTS-UNAUTH PASS status_code=mcp_auth_rejects_unauth POST /internal/mcp/github_comment → status=401
- M032-WORKSPACE-ON-AZURE-FILES SKIP status_code=workspace_mount_unavailable Azure Files mount not available (EACCES) — run on orchestrator with mounted share
```
Exit code: 0

---

### TC-03: JSON mode emits valid structured output

**Steps:**
1. `bun run verify:m032 --json | jq '.overallPassed'`

**Expected outcome:** `true`

2. `bun run verify:m032 --json | jq '.checks | length'`

**Expected outcome:** `3`

3. `bun run verify:m032 --json | jq '.checks[0].id'`

**Expected outcome:** `"M032-JOB-SPEC-NO-SECRETS"`

---

### TC-04: TypeScript compilation clean

**Steps:**
1. `bun run tsc --noEmit`

**Expected outcome:** No output, exit code 0.

---

### TC-05: deploy.sh syntax valid

**Steps:**
1. `bash -n deploy.sh`

**Expected outcome:** No output, exit code 0.

---

### TC-06: JOB-SPEC-NO-SECRETS contract — verify forbidden names trigger failure

**Steps (manual verification of check logic):**
1. From a Bun REPL or test: Call `runJobSpecNoSecrets` with a `_buildAcaJobSpecFn` that injects `DATABASE_URL` into the env array.
2. Assert `check.passed === false` and `check.detail` contains `DATABASE_URL`.

**Expected outcome:** Check fails with `status_code=job_spec_leaks_secrets` and detail naming the forbidden key. (Covered by TC-01 pass via test `fail: _fn injects a forbidden name into env`.)

---

### TC-07: MCP-AUTH-REJECTS-UNAUTH — verify 200 triggers failure

**Steps (manual verification of check logic):**
1. Call `runMcpAuthRejectsUnauth` with an `_appFn` returning a 200 response.
2. Assert `check.passed === false` and `check.status_code === 'mcp_auth_accepts_unauth'`.

**Expected outcome:** Check fails with appropriate detail. (Covered by TC-01 via test `fail: _appFn returns 200`.)

---

### TC-08: WORKSPACE-ON-AZURE-FILES — graceful skip on missing mount

**Steps:**
1. On a machine without /mnt/kodiai-workspaces/ mounted: `bun run verify:m032 --json | jq '.checks[2]'`

**Expected outcome:**
```json
{
  "id": "M032-WORKSPACE-ON-AZURE-FILES",
  "passed": false,
  "skipped": true,
  "status_code": "workspace_mount_unavailable"
}
```
`overallPassed` is still `true` (skipped checks excluded from gate).

---

### TC-09: WORKSPACE-ON-AZURE-FILES — passes on orchestrator with real mount

**Preconditions:** Azure Files share mounted at `/mnt/kodiai-workspaces/` (run on orchestrator container).

**Steps:**
1. `bun run verify:m032`

**Expected outcome:**
```
- M032-WORKSPACE-ON-AZURE-FILES PASS status_code=workspace_on_azure_files path="/mnt/kodiai-workspaces/test-job-id-001" starts with mountBase="/mnt/kodiai-workspaces"
```

---

### TC-10: Harness exits 1 when a check fails

**Steps (programmatic):**
1. Call `buildM032ProofHarness({ _appFn: () => ({ fetch: async () => new Response(null, { status: 200 }) }) })`
2. Assert `exitCode === 1`
3. Assert stderr contains `verify:m032 failed: M032-MCP-AUTH-REJECTS-UNAUTH:mcp_auth_accepts_unauth`

**Expected outcome:** exitCode 1, stderr message names the failing check. (Covered by TC-01 via test `exit code 1 and stderr message when MCP check fails`.)

