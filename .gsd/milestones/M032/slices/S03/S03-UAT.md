# S03: Agent Job Entrypoint + Executor Refactor — UAT

**Milestone:** M032
**Written:** 2026-03-29T19:18:39.882Z

## UAT: S03 — Agent Job Entrypoint + Executor Refactor

### Preconditions

- Local dev environment with Bun installed
- `bun run tsc --noEmit` passes before starting (baseline)
- S01 and S02 slice code in place (aca-launcher.ts exports, McpJobRegistry)
- No live Azure credentials required for unit-test UAT steps
- For live demo steps (optional): Azure CLI authenticated, ACA Job provisioned, Azure Files mount configured

---

### Test Cases

#### TC-01: cancelAcaJob exported and callable

**Purpose:** Verify cancelAcaJob is exported and accepts the correct signature.

1. Run `bun test ./src/jobs/aca-launcher.test.ts --filter "cancelAcaJob"`
2. **Expected:** All 3 cancelAcaJob tests pass — callable, accepts required opts, accepts optional logger.

---

#### TC-02: acaResourceGroup and acaJobName config defaults

**Purpose:** Verify zero-config deployments work with provisioned resource names as defaults.

1. Run `bun test ./src/routes/slack-events.test.ts` and `bun test ./src/routes/slack-commands.test.ts`
2. **Expected:** Both test suites pass without AppConfig stub errors for acaResourceGroup/acaJobName.
3. Alternatively, inspect `src/config.ts` — `acaResourceGroup` must have `.default("rg-kodiai")` and `acaJobName` must have `.default("caj-kodiai-agent")`.

---

#### TC-03: Dockerfile.agent syntax and CMD

**Purpose:** Verify agent container image definition is syntactically valid and uses the correct entrypoint.

1. Run `bash -n Dockerfile.agent`
2. **Expected:** Exit 0 (no syntax errors).
3. Inspect `Dockerfile.agent` — CMD must be `bun run src/execution/agent-entrypoint.ts` and there must be no EXPOSE directive.

---

#### TC-04: agent-entrypoint exits 1 on missing env vars

**Purpose:** Verify the ACA job container fails fast with a clear message when required env vars are absent.

1. Run `bun test ./src/execution/agent-entrypoint.test.ts --filter "missing env vars"`
2. **Expected:** 4 tests pass — WORKSPACE_DIR missing → exit 1, MCP_BASE_URL missing → exit 1, MCP_BEARER_TOKEN missing → exit 1, both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN missing → exit 1. CLAUDE_CODE_OAUTH_TOKEN present alone → no exit 1.

---

#### TC-05: agent-entrypoint exits 1 on missing or invalid agent-config.json

**Purpose:** Verify the container fails fast when configuration is malformed.

1. Run `bun test ./src/execution/agent-entrypoint.test.ts --filter "agent-config.json errors"`
2. **Expected:** 2 tests pass — file missing → exit 1, invalid JSON → exit 1.

---

#### TC-06: agent-entrypoint happy path — CLAUDE.md, MCP servers, SDK, result.json

**Purpose:** Verify the full success path produces the correct output artifacts and SDK invocation.

1. Run `bun test ./src/execution/agent-entrypoint.test.ts --filter "happy path"`
2. **Expected:** 4 tests pass:
   - CLAUDE.md written to WORKSPACE_DIR before SDK is invoked
   - 7 MCP server names all present in queryFn mcpServers argument (github_comment, reviewCommentThread, github_inline_comment, github_ci, review_checkpoint, github_issue_label, github_issue_comment)
   - prompt, model, maxTurns, allowedTools from agent-config.json passed to SDK
   - result.json written with conclusion: 'success' and correct fields

---

#### TC-07: agent-entrypoint error fallback — result.json written on SDK failure

**Purpose:** Verify the container writes a recoverable result even on failure (orchestrator can read it).

1. Run `bun test ./src/execution/agent-entrypoint.test.ts --filter "SDK error handling"`
2. **Expected:** 2 tests pass — SDK iterator throws → result.json with conclusion: 'error' and errorMessage; no result message received → result.json with conclusion: 'error'.

---

#### TC-08: createExecutor() ACA dispatch — happy path

**Purpose:** Verify executor dispatches ACA job and returns ExecutionResult on success.

1. Run `bun test ./src/execution/executor.test.ts --filter "ACA dispatch: happy path"`
2. **Expected:** 2 tests pass — poll returns succeeded → ExecutionResult returned; durationMs falls back to poll value when jobResult lacks it.

---

#### TC-09: createExecutor() timeout path — cancelAcaJob called

**Purpose:** Verify timed-out jobs are cancelled and a timeout ExecutionResult is returned.

1. Run `bun test ./src/execution/executor.test.ts --filter "timeout path"`
2. **Expected:** 1 test passes — poll returns timed-out → cancelAcaJob called once, timeout ExecutionResult returned.

---

#### TC-10: createExecutor() failed path — no cancel, failure result

**Purpose:** Verify failed jobs don't trigger cancellation (job already done).

1. Run `bun test ./src/execution/executor.test.ts --filter "failed path"`
2. **Expected:** 1 test passes — poll returns failed → cancelAcaJob NOT called, failure ExecutionResult returned.

---

#### TC-11: mcpJobRegistry token lifecycle

**Purpose:** Verify per-job bearer token is registered before launch and unregistered after completion (all paths).

1. Run `bun test ./src/execution/executor.test.ts --filter "registry"`
2. **Expected:** 3 tests pass — token registered before launch on success path; token unregistered on timeout path; token unregistered on failed path.

---

#### TC-12: published flag propagation from onPublish callback

**Purpose:** Verify MCP server onPublish callback fires during job execution and result has published:true.

1. Run `bun test ./src/execution/executor.test.ts --filter "published flag"`
2. **Expected:** 2 tests pass — onPublish called directly → result.published = true; executor merges published from jobResult.

---

#### TC-13: Full test suite + TypeScript compilation

**Purpose:** Confirm all S03 code compiles cleanly and no regressions introduced in S01/S02 tests.

1. Run `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts`
2. **Expected:** 56 pass, 0 fail.
3. Run `bun run tsc --noEmit`
4. **Expected:** Exit 0, no output.

---

#### TC-14 (Optional — live demo): GitHub mention → ACA Job execution

**Preconditions:** Azure CLI authenticated, ACA Job provisioned as caj-kodiai-agent in rg-kodiai, Dockerfile.agent built and pushed to ACR, orchestrator deployed with S03 changes.

1. Post `@kodiai please review this PR` as a comment on a test GitHub PR.
2. Navigate to Azure portal → Container Apps → caj-kodiai-agent → Executions.
3. **Expected:** A new execution appears within ~30 seconds. Execution completes. GitHub PR comment posted with agent response.
4. View job logs in Azure portal or `az containerapp job execution logs show`.
5. **Expected:** Only `ANTHROPIC_API_KEY`, `MCP_BEARER_TOKEN`, `WORKSPACE_DIR`, `GITHUB_INSTALLATION_TOKEN` present in env — no DATABASE_URL, GITHUB_APP_PRIVATE_KEY, or other application secrets.
