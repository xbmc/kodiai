# S04 Research: verify:m032 Proof Harness + Deploy Updates

**Authored:** 2026-03-29  
**Classification:** Light — established pattern, known code, no novel technology

---

## Summary

S04 is a straight application of the `verify:m031` pattern. Three deliverables:

1. `scripts/verify-m032.ts` — pure-code proof harness (3–4 checks, all deterministic)
2. `scripts/verify-m032.test.ts` — unit tests following `verify-m031.test.ts` structure exactly
3. `package.json` — add `"verify:m032": "bun scripts/verify-m032.ts"` to scripts

No new modules, no new dependencies, no architectural decisions. The checks assert contracts already enforced by S01–S03 code.

---

## Implementation Landscape

### Reference pattern: `scripts/verify-m031.ts`

The exact structure to replicate:
- `M032_CHECK_IDS` — `as const` array of check ID strings
- `Check` type — `{ id, passed, skipped, status_code, detail? }`
- `EvaluationReport` type — `{ check_ids, overallPassed, checks }`
- One `runXxx(opts?)` function per check — `_fn` override injection pattern
- `evaluateM031(opts?)` — `Promise.all` across all checks, computes `overallPassed` excluding skipped
- `renderReport()` — human-readable text output
- `buildM031ProofHarness(opts?)` — injectable stdout/stderr, json flag, returns `{ exitCode }`
- `if (import.meta.main)` CLI runner at the bottom

### What M032 checks should assert

Based on the milestone success criteria and what S01–S03 actually built:

**Check 1: M032-JOB-SPEC-NO-SECRETS** (pure-code)  
Call `buildAcaJobSpec(validOpts)` and assert no `APPLICATION_SECRET_NAMES` appears in the returned `spec.env` array. This is the core security contract. Import `buildAcaJobSpec` and `APPLICATION_SECRET_NAMES` from `src/jobs/aca-launcher.ts`.

**Check 2: M032-MCP-AUTH-REJECTS-UNAUTH** (pure-code)  
Call `createMcpHttpRoutes(registry)` and make an HTTP request to `/internal/mcp/github_comment` without a valid bearer token. Assert the response status is 401. Uses the existing `createMcpJobRegistry()` with no registered tokens. Imports from `src/execution/mcp/http-server.ts`.

**Check 3: M032-WORKSPACE-ON-AZURE-FILES** (pure-code)  
Call `createAzureFilesWorkspaceDir({ mountBase: '/mnt/kodiai-workspaces', jobId: 'test-id' })` and assert the returned path starts with `/mnt/kodiai-workspaces/`. Import from `src/jobs/workspace.ts`. Note: this creates a directory — needs a temp mock or the function needs a `_mkdirFn` injection. Check the implementation first.

**Check 4: M032-ENTRYPOINT-ENV-ISOLATION** (pure-code)  
Check that `MCP_SERVER_NAMES` from `agent-entrypoint.ts` does not include any `APPLICATION_SECRET_NAMES` values. This is a structural/naming check: the entrypoint only connects to MCP servers by name (not by secret key). Simpler: verify `MCP_SERVER_NAMES.length === 7` (all 7 MCP servers registered, consistent with what S03 built).

Alternatively, the entrypoint check can be: call `main()` with a `readFileFn` that returns a valid `AgentConfig` JSON, a stub `queryFn` that returns an async iterable with no messages, and a stub `writeFileFn`/`exitFn`. Assert no application secret names appear as URL components in the MCP server config built from env vars. This is a bit heavy — probably better to use the simpler structural checks (1 and 2) and keep the test surface focused on the contracts explicitly listed in the milestone success criteria.

**Recommendation:** 3 checks is the right scope: JOB-SPEC-NO-SECRETS, MCP-AUTH-REJECTS-UNAUTH, WORKSPACE-ON-AZURE-FILES. The entrypoint isolation is implicitly covered by check 1 (the entrypoint receives no secrets because the job spec has none).

### `createAzureFilesWorkspaceDir` — injection concern

Check the actual implementation before writing the harness:

```ts
// src/jobs/workspace.ts
export async function createAzureFilesWorkspaceDir(opts: {
  mountBase: string;
  jobId: string;
}): Promise<string>
```

This likely calls `mkdir`. A pure-code harness check that calls it will create a real directory. Two options:
- Add `_mkdirFn?` injection parameter (matches M031 `_fn` pattern)
- Or: just assert the path shape (startsWith) by mocking `createAzureFilesWorkspaceDir` at the check level using the `_fn` override pattern (pass a stub that returns a fake path)

The `_fn` override is cleaner — keep the workspace check as: `assert returned path starts with mountBase`.

### MCP auth check implementation detail

`createMcpHttpRoutes(registry)` returns a Hono app. To test it without starting a real server, use Hono's `app.request(url, init)` method — the same pattern used in `http-server.test.ts`. Check that file for the exact pattern to copy:

```ts
const res = await app.request('/internal/mcp/github_comment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ... })
});
expect(res.status).toBe(401);
```

This is pure-code — no network, no server startup. Confirmed to work from http-server.test.ts.

### `package.json` script entry

Current pattern: `"verify:m031": "bun scripts/verify-m031.ts"`. Add:
```json
"verify:m032": "bun scripts/verify-m032.ts"
```

### Deploy.sh status

S01 and S03 already added the storage account, Azure Files share, ACA environment storage mount, Dockerfile.agent build, and ACA Job create/update sections. The S04 roadmap note says "deploy.sh run against existing env → all Azure resources verified/created, exits 0 (idempotent re-run succeeds)". This is a **live ops verification** — not a code change. The deploy.sh already has the additions from S01/S03. S04 should verify it's syntactically valid (`bash -n deploy.sh`) but no new sections are needed unless something was missed.

---

## File Map

| File | Action | Notes |
|------|--------|-------|
| `scripts/verify-m032.ts` | Create | Proof harness — 3 checks, pattern from verify-m031.ts |
| `scripts/verify-m032.test.ts` | Create | Unit tests — pattern from verify-m031.test.ts |
| `package.json` | Edit | Add `"verify:m032"` script entry |
| `src/jobs/workspace.ts` | Maybe edit | Add `_mkdirFn?` injection to `createAzureFilesWorkspaceDir` if needed for pure-code test |

---

## Recommendation

**Single task.** Everything here is ~150 lines of code following an established template. No seams to divide across tasks. One context window builds both files and the package.json entry.

**Checks:** JOB-SPEC-NO-SECRETS, MCP-AUTH-REJECTS-UNAUTH, WORKSPACE-ON-AZURE-FILES (3 checks, all pure-code, none skippable).

**Verification commands:**
```
bun test ./scripts/verify-m032.test.ts
bun run verify:m032
bun run tsc --noEmit
bash -n deploy.sh
```

All should exit 0.
