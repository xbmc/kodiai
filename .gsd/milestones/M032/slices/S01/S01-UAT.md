# S01: ACA Job + Azure Files Infrastructure — UAT

**Milestone:** M032
**Written:** 2026-03-29T18:29:18.929Z

## UAT: S01 — ACA Job + Azure Files Infrastructure

### Preconditions

- Bun runtime installed and `bun` on PATH
- Working directory: `/home/keith/src/kodiai`
- No Azure credentials required for the contract check (Tests 1–3)
- Azure CLI + active subscription required only for Test 4 (live mode)

---

### Test 1: Pure-code CONTRACT check passes

**Purpose:** Verify the core security invariant — `buildAcaJobSpec` never puts application secret names in the job env array.

**Steps:**
1. Run `bun run scripts/test-aca-job.ts`
2. Observe output

**Expected outcome:**
```
==> ACA Job contract check: no application secrets in job spec env array
✅ CONTRACT: no application secrets in job spec env array
   Env vars in spec: MCP_BEARER_TOKEN, WORKSPACE_DIR
==> Skipping live test (pass --live to run a real ACA Job execution)
```
Exit code: 0

---

### Test 2: All 16 unit tests pass

**Purpose:** Verify the launcher module spec builder and result reader work correctly in all branches.

**Steps:**
1. Run `bun test ./src/jobs/aca-launcher.test.ts`

**Expected outcome:**
```
 16 pass
 0 fail
```
All named tests pass:
- `APPLICATION_SECRET_NAMES > is a non-empty readonly array`
- `APPLICATION_SECRET_NAMES > contains the expected secret key names`
- `buildAcaJobSpec > no APPLICATION_SECRET_NAMES in env array`
- `buildAcaJobSpec > required env keys present — MCP_BEARER_TOKEN and WORKSPACE_DIR`
- `buildAcaJobSpec > ANTHROPIC_API_KEY included when provided`
- `buildAcaJobSpec > ANTHROPIC_API_KEY absent when not provided`
- `buildAcaJobSpec > GITHUB_INSTALLATION_TOKEN included when provided`
- `buildAcaJobSpec > GITHUB_INSTALLATION_TOKEN absent when not provided`
- `buildAcaJobSpec > default timeoutSeconds is 600`
- `buildAcaJobSpec > custom timeoutSeconds is respected`
- `buildAcaJobSpec > throws if APPLICATION_SECRET_NAMES passed via opts — runtime guard`
- `readJobResult > reads and parses result.json`
- `readJobResult > throws if result.json does not exist`
- `readJobResult > throws if result.json is not valid JSON`

Exit code: 0

---

### Test 3: TypeScript compilation clean

**Purpose:** No type errors introduced by S01 changes.

**Steps:**
1. Run `bun run tsc --noEmit`

**Expected outcome:** No output, exit code 0.

---

### Test 4: deploy.sh bash syntax clean

**Purpose:** All new deploy.sh sections parse without syntax errors.

**Steps:**
1. Run `bash -n deploy.sh`

**Expected outcome:** No output, exit code 0.

---

### Test 5: APPLICATION_SECRET_NAMES contract — edge cases

**Purpose:** Verify the exported list is complete and the runtime guard catches any forbidden name.

**Steps (manual inspection):**
1. Read `src/jobs/aca-launcher.ts` and confirm `APPLICATION_SECRET_NAMES` contains all nine names: GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_BASE64, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, VOYAGE_API_KEY, BOT_USER_PAT
2. Confirm that `buildAcaJobSpec` with only `{ jobName, image, workspaceDir, mcpBearerToken }` produces an env array containing exactly `MCP_BEARER_TOKEN` and `WORKSPACE_DIR` (no other keys)
3. Confirm that `buildAcaJobSpec` with `anthropicApiKey` provided adds `ANTHROPIC_API_KEY` (and still no forbidden keys)
4. Confirm that `buildAcaJobSpec` with `githubInstallationToken` provided adds `GITHUB_INSTALLATION_TOKEN` (and still no forbidden keys)

**Expected outcome:** All four sub-checks pass per unit tests. The runtime guard ensures no variation of the API can accidentally include a forbidden name.

---

### Test 6: Live mode — missing env vars skip gracefully

**Purpose:** Verify the live path does not crash when Azure env vars are absent.

**Steps:**
1. Run `bun run scripts/test-aca-job.ts --live` with no Azure env vars set

**Expected outcome:**
```
✅ CONTRACT: no application secrets in job spec env array
...
==> Live mode: dispatching real ACA Job...
==> Skipping live test: missing env vars: RESOURCE_GROUP, ACA_JOB_NAME, AZURE_WORKSPACE_MOUNT
   Set these env vars and re-run with --live to exercise a real ACA Job.
```
Exit code: 0 (graceful skip, not crash)

---

### Test 7 (Operator): Live ACA Job dispatch

**Preconditions:** Azure CLI authenticated, ACA Job provisioned via `deploy.sh`, env vars set.

**Steps:**
1. Set `RESOURCE_GROUP`, `ACA_JOB_NAME`, `AZURE_WORKSPACE_MOUNT`
2. Run `bun run scripts/test-aca-job.ts --live`

**Expected outcome:**
- Contract check passes
- ACA Job dispatched, execution name printed
- Poll loop runs until `succeeded` or `failed`
- Cold start timing printed in ms
- Exit code: 0 if succeeded, 1 if failed or timed out

**Portal check:** Open Azure portal → Container Apps → `caj-kodiai-agent` → Execution history. Confirm the execution name from the script output appears in the list with status Succeeded.
