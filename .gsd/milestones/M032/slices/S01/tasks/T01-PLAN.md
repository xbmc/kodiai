---
estimated_steps: 14
estimated_files: 3
skills_used: []
---

# T01: ACA Job Launcher Module — spec builder, dispatch, poll, result reader

Create `src/jobs/aca-launcher.ts` with the ACA Job infrastructure layer. This is the core security contract: `buildAcaJobSpec` must never put application secrets in the job's env array.

**Steps:**
1. Define `AcaJobEnvVar` and `AcaJobSpec` types in the module.
2. Export `APPLICATION_SECRET_NAMES: readonly string[]` — copy the same list from `src/execution/env.test.ts` (GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_BASE64, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, VOYAGE_API_KEY, BOT_USER_PAT). This list is the contract artifact.
3. Implement `buildAcaJobSpec(opts: { jobName: string; image: string; workspaceDir: string; anthropicApiKey?: string; mcpBearerToken: string; githubInstallationToken?: string; timeoutSeconds?: number; }): AcaJobSpec` — builds the spec with env array containing only: ANTHROPIC_API_KEY (if provided), MCP_BEARER_TOKEN, WORKSPACE_DIR, GITHUB_INSTALLATION_TOKEN (if provided). Validate at runtime that no APPLICATION_SECRET_NAMES appear in env names; throw if any do.
4. Implement `launchAcaJob(opts: { resourceGroup: string; jobName: string; spec: AcaJobSpec; logger?: Logger; }): Promise<{ executionName: string }>` — uses Bun `$` to run `az containerapp job execution start` with JSON env overrides. Log dispatch at info.
5. Implement `pollUntilComplete(opts: { resourceGroup: string; jobName: string; executionName: string; timeoutMs: number; pollIntervalMs?: number; logger?: Logger; }): Promise<{ status: 'succeeded' | 'failed' | 'timed-out'; durationMs: number }>` — polls `az containerapp job execution show` every 10s by default, respects timeout.
6. Implement `readJobResult(workspaceDir: string): Promise<unknown>` — reads and JSON-parses `{workspaceDir}/result.json`.
7. In `src/jobs/workspace.ts`, add exported `createAzureFilesWorkspaceDir(opts: { mountBase: string; jobId: string; }): Promise<string>` — creates `{mountBase}/{jobId}` directory and returns its path. No other changes to workspace.ts.
8. Write `src/jobs/aca-launcher.test.ts` with:
   - `buildAcaJobSpec: no APPLICATION_SECRET_NAMES in env array` — iterates APPLICATION_SECRET_NAMES, asserts none appear as env var names in a freshly built spec
   - `buildAcaJobSpec: required env keys present` — asserts MCP_BEARER_TOKEN and WORKSPACE_DIR are in the env array
   - `buildAcaJobSpec: throws if APPLICATION_SECRET_NAMES passed via opts` — pass a spec-building option that somehow injects a secret name and verify the runtime guard throws
   - `readJobResult: reads and parses result.json` — write a real temp file, call readJobResult, assert parsed value

## Inputs

- `src/jobs/types.ts`
- `src/execution/env.ts`
- `src/execution/env.test.ts`
- `src/jobs/workspace.ts`

## Expected Output

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`

## Verification

bun test ./src/jobs/aca-launcher.test.ts

## Observability Impact

launchAcaJob logs dispatch at info with executionName + jobName + workspaceDir. pollUntilComplete logs each attempt at debug, final status at info with durationMs.
