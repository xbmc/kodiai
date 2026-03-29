---
estimated_steps: 17
estimated_files: 3
skills_used: []
---

# T01: Write verify-m032 proof harness + tests + package.json entry

Create scripts/verify-m032.ts with 3 pure-code checks following the verify-m031 pattern exactly:

**Check 1: M032-JOB-SPEC-NO-SECRETS** — Call `buildAcaJobSpec({ jobName: 'test-job', image: 'test-image', workspaceDir: '/tmp/test', mcpBearerToken: 'tok', mcpBaseUrl: 'http://localhost', timeoutSeconds: 600 })`. Assert that none of `APPLICATION_SECRET_NAMES` appear in `spec.env.map(e => e.name)`. Pass if the array contains zero forbidden names; fail with detail listing which names were found.

**Check 2: M032-MCP-AUTH-REJECTS-UNAUTH** — Create `createMcpJobRegistry()` with no tokens registered. Create `createMcpHttpRoutes(registry)`. Call `app.fetch(new Request('http://localhost/internal/mcp/github_comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }) }))`. Assert `res.status === 401`. Accept optional `_appFn?` override for testability.

**Check 3: M032-WORKSPACE-ON-AZURE-FILES** — Accept optional `_workspaceFn?: (opts: { mountBase: string; jobId: string }) => Promise<string>`. When absent, call the real `createAzureFilesWorkspaceDir`. Assert the returned path starts with the provided `mountBase`. In tests, pass a stub so no real mkdir happens.

Follow verify-m031.ts structure exactly:
- `M032_CHECK_IDS` as const array
- `Check` and `EvaluationReport` types
- `evaluateM032(opts?)` running all 3 checks via `Promise.all`
- `renderReport()` human-readable text
- `buildM032ProofHarness(opts?)` with injectable stdout/stderr/json, returns `{ exitCode }`
- `if (import.meta.main)` CLI runner

Create scripts/verify-m032.test.ts following verify-m031.test.ts structure:
- 2–3 tests per check (pass path + fail path via _fn injection)
- evaluateM032 integration tests (overallPassed true/false)
- buildM032ProofHarness tests (text output, json mode, exitCode 0/1)

Add `"verify:m032": "bun scripts/verify-m032.ts"` to package.json scripts (after verify:m031 entry).

Note on WORKSPACE check: the real `createAzureFilesWorkspaceDir` calls `mkdir` which needs a real path. Tests must always pass `_workspaceFn` stub. The harness default (no opts) calls the real function only from CLI — for the pure-code test gate, the check is injectable.

## Inputs

- `scripts/verify-m031.ts`
- `scripts/verify-m031.test.ts`
- `src/jobs/aca-launcher.ts`
- `src/execution/mcp/http-server.ts`
- `src/jobs/workspace.ts`
- `package.json`

## Expected Output

- `scripts/verify-m032.ts`
- `scripts/verify-m032.test.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m032.test.ts && bun run verify:m032 && bun run tsc --noEmit && bash -n deploy.sh
