# Project Knowledge

Recurring gotchas and non-obvious patterns found during execution.

---

## DB Migrations — `IF NOT EXISTS` on idempotent `ALTER TABLE`

**Context:** `runMigrations()` tracks applied files in `_migrations` by filename. If a column is added manually (e.g., by a prior partial run or direct SQL), the migration file won't be in `_migrations`, so it will attempt to apply again and fail with `column already exists`.

**Rule:** Always use `ADD COLUMN IF NOT EXISTS` for `ALTER TABLE ADD COLUMN` migrations. PostgreSQL ≥ 9.6 supports this syntax.

**File:** `src/db/migrations/031-wiki-comment-identity.sql` — fixed in M028/S03/T02.

---

## S01 Task Summaries vs Actual Code State (M028)

**Context:** S01 T03 summary claimed `formatPageComment` was rewritten to remove `**Why:**` and voice-mismatch prose. The verification result was `passed`. But the actual code (`src/knowledge/wiki-publisher.ts`) still had both lines — and the publisher test guarded only the first line (the marker) rather than the full comment body.

**How it happened:** The T03 test checked `expect(markerLine).not.toContain("**Why:**")` — the marker line (line 0) obviously doesn't contain it; the test passed trivially without exercising the actual contract.

**Rule:** Negative regression guards for `formatPageComment` must check the **full comment body**, not just the marker line. The correct assertion is:
```ts
const result = formatPageComment(group, "xbmc", "xbmc");
expect(result).not.toContain("**Why:**");
expect(result).not.toContain(":warning:");
```

**Fixed in:** M028/S03/T02 — removed `**Why:**` and voice-mismatch lines from `formatPageComment`; updated tests to assert on full body.

---

## Bun Parser Rejects Bare `:warning:` in JSDoc Comments

**Context:** `scripts/verify-m028-s04.ts` initially had JSDoc lines like:
```
* formatSummaryTable has no **Why:**/:warning:/Wiki Update Suggestions
```
This caused `error: Unexpected :` at parse time in Bun v1.3.8.

**Rule:** Avoid bare `:emoji:` colon-notation in `/** ... */` JSDoc comment blocks when using Bun. Replace with plain-text descriptions. Regular string literals and template strings in code are fine — only JSDoc block comment lines are affected.

**Fixed by:** Changing `:warning:` to `warning` in JSDoc-only; code/string/test references to `:warning:` work fine.

---

## buildM028-style Harness Auto-Probes DATABASE_URL When sql=undefined

**Context:** `buildM028S04ProofHarness` (and S03 equivalent) calls `createDbClient` from env if `opts?.sql` is `undefined`. Tests that want to exercise the "DB checks skip" path must pass a **rejecting sql stub** rather than `undefined` — otherwise the harness may find `DATABASE_URL` in the test environment and actually connect.

**Rule:** When testing `buildM028*ProofHarness` DB-skip behavior, use:
```ts
const sql = () => Promise.reject(new Error("test: no db"));
```
Not `sql: undefined`.

---

## Two-Layer Reasoning-Prose Defence (M029/S01)

**Context:** `generateWithVoicePreservation` in `wiki-voice-validator.ts` now guards against LLM reasoning prose at two independent layers.

**Layer 1 — Runtime filter (deterministic):** `isReasoningProse(text)` fires immediately after `generateFn()` returns, before any template or voice-validation LLM calls. It trims the input and matches `/^(I'll|Let me|I will|Looking at|I need to)/i`. Returns true → drop suggestion, emit `logger.warn`, return `{ suggestion: "", feedback: "Reasoning prose detected: suggestion dropped" }`.

**Layer 2 — Prompt instruction:** `buildVoicePreservingPrompt` contains a `## Output Contract` section listing the same five starters verbatim and instructing the LLM to begin output directly with the updated section text.

**Rule:** When extending either layer, update both — the prompt instruction and the runtime regex must list the same starters. If a new starter is added to `isReasoningProse`, add it to the `## Output Contract` section too, and vice versa. The test for the prompt (`prompt.includes("I'll")`) acts as a cross-check that both layers agree.

**Pattern:** Pre-LLM deterministic filter = `trim → anchored regex → early return before any I/O-bound calls`. Place deterministic gates as early as possible in the pipeline. This is the established pattern for quality enforcement at generation time in this codebase.

---

## SQL-Capture Mock Pattern for Testing Query Shape Without a Real DB (M029/S02)

**Context:** `createUpdateGenerator` runs SQL via a tagged-template `sql` function. The page-selection query must include `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}`. Verifying this without a real DB requires capturing what SQL string + parameters were actually generated.

**Pattern:** Pass a mock tagged-template function as the `sql` argument. The mock records `(strings.join("?"), values)` for each call, then returns a safe empty-row result. After calling `generator.run(...)`, assert on the captured record:

```ts
const calls: { query: string; values: unknown[] }[] = [];
const sql = mock((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ query: strings.join("?"), values });
  return Promise.resolve([]);
}) as unknown as Sql;

const generator = createUpdateGenerator({ sql, taskRouter, logger });
await generator.run({ topN: 5 });

const pageSelectCall = calls.find(c => c.query.includes("heuristic_score >="));
expect(pageSelectCall).toBeDefined();
expect(pageSelectCall!.values).toContain(MIN_HEURISTIC_SCORE);
```

**Rule:** Use this pattern (not a full integration test) for asserting that a constant is wired into a SQL clause. The string-join approach works because tagged-template literals interleave static strings and dynamic values — `strings.join("?")` produces the query skeleton; `values` holds the interpolated arguments.

**Caveat:** If the page-selection call is not the first SQL call, use `.find()` rather than `calls[0]` to locate it by a distinctive query substring.

**Established in:** M029/S02/T01 (`wiki-update-generator.test.ts`, `createUpdateGenerator page selection` describe block).


---

## Dry-Run-First Pattern for One-Shot Operational Scripts (M029/S03)

**Context:** `scripts/cleanup-wiki-issue.ts` is a destructive one-time script that deletes GitHub issue comments. It needs to be safe by default and auditable before execution.

**Pattern:** `--dry-run` is the default (no explicit flag needed). Mutations require explicit `--no-dry-run`. Per-item output lines are prefixed `[DRY RUN]`/`[DELETED]`/`[FAILED]` so they are grep-able in CI logs. A `--- Summary ---` block is always printed at exit regardless of success/error/dry-run state — this gives an auditable count for every run.

**Auth skeleton:** Copy from `cleanup-legacy-branches.ts` verbatim: `loadPrivateKey`, `AppConfig` stub, `createGitHubApp`, `getRepoInstallationContext`. Any future operational script needing GitHub App auth should port this skeleton.

**Required-arg validation:** Required flags exit 1 with `ERROR: --<flag> is required`. Non-integer numeric flags exit 1 with `ERROR: --<flag> must be a positive integer, got: <value>`. Use `parseInt` + strict string round-trip check: `parseInt(v, 10).toString() !== v`.

**Established in:** M029/S03/T01 (`scripts/cleanup-wiki-issue.ts`).

---

## Sequential SQL Stub for Multi-Check Proof Harnesses (M029/S04)

**Context:** `evaluateM029S04(opts)` runs two DB-gated checks (`NO-REASONING-IN-DB` and `LIVE-PUBLISHED`) in a single `Promise.all` call. Each check calls `sql` with a different query, so the stub needs to return different rows for each call.

**Pattern:**

```ts
function makeSequentialSqlStub(responses: unknown[][]) {
  let callIndex = 0;
  return mock((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    const rows = responses[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(rows);
  }) as unknown as Sql;
}

// Usage: first call returns [{count: "0"}], second returns [{count: "5"}]
const sql = makeSequentialSqlStub([[{ count: "0" }], [{ count: "5" }]]);
```

**When to use `makeSequentialSqlStub` vs `makeSqlStub`:**
- `makeSqlStub(rows)` — use when all SQL calls in a test should return the same rows (e.g., both checks should see count=0).
- `makeSequentialSqlStub(responses[])` — use when a single `evaluateM*(opts)` call makes multiple SQL calls that need different results (e.g., NO-REASONING-IN-DB gets one shape, LIVE-PUBLISHED gets another).

**Established in:** M029/S04/T01 (`scripts/verify-m029-s04.test.ts`).

---

## `_fn` Override Pattern for Pure-Code Harness Checks (M029/S04)

**Context:** Pure-code proof harness checks (CONTENT-FILTER-REJECTS, PROMPT-BANS-META) import production functions directly. Tests need to inject failing mock implementations without rewriting the imports.

**Pattern:** Accept optional `_contentFilterFn?: (text: string) => boolean` and `_promptBuilderFn?: (...) => string` parameters in the check function signature. The suffix `_` signals "test-override, not production dependency". When the parameter is absent (undefined), the real import is called. When present, the injected fn is used.

```ts
async function runContentFilterRejects(opts?: {
  _contentFilterFn?: (text: string) => boolean;
}) {
  const filterFn = opts?._contentFilterFn ?? isReasoningProse;
  const result = filterFn("I'll analyze...");
  // ...
}
```

**Rule:** This pattern requires no DI framework and no module mocking. The `_` prefix is the convention — it signals "test injection point" to future readers without ambiguity about production wiring.

**Established in:** M029/S04/T01 (`scripts/verify-m029-s04.ts` and `verify-m029-s04.test.ts`).

---

## "Code-Complete vs Operationally Complete" Milestone Closure (M029)

**Context:** M029 criteria 5 and 6 (no reasoning prose in DB, issue #5 clean) require live DB and GitHub access that is not available during automated milestone closure. The proof harness exits 0 with `overallPassed: true` in CI because skipped checks are excluded from the pass/fail computation — this is by design.

**Rule:** A milestone is "code-complete" when the deterministic (pure-code) checks pass and the infra-gated checks skip gracefully. It is "operationally complete" when an operator executes the ops runbook (in M029's case: `docs/m029-s04-ops-runbook.md`) and all 5 harness checks return non-skipped passes.

**Implication for milestone summaries:** Document infra-gated criteria as "⚠️ Pending ops runbook execution" rather than "failed" — they aren't failures, they're deferred live operations. The harness check IDs and skip conditions are the proof that the code is in place.

**Established in:** M029/S04 — same pattern as M027/M028 DB/GitHub-gated checks.

---

## `bun run tsc --noEmit` Gate Requires Exit 0 — All Pre-Existing Errors Must Be Fixed

**Context:** M030/S01/T02 reduced the pre-existing tsc error count from 68 to 56 (by adding `addonRepos: []` to 10 AppConfig stubs). The task summary described this as acceptable — "zero new M030 errors". But the verification gate requires exit 0, not just "no new errors". The slice closer had to fix all 53 remaining errors.

**Rule:** Whenever `bun run tsc --noEmit` is a verification step and the gate requires exit 0, all TypeScript errors in the repo must be fixed — including pre-existing ones. Do not stop at "no new errors from this task".

**Pattern:** If pre-existing errors are numerous, fix them in batches by category:
1. Interface type mismatches (store `listRepairCandidates` return types, etc.) — align interface types with actual implementations
2. Const literal narrowing (`.includes()` on narrow const arrays vs wider union) — cast to `(array as readonly string[]).includes(value)`
3. TS closure narrowing (optional method called inside returned closure) — destructure after guard: `const { fn } = obj; return { method: () => fn() }`
4. Mock type casts in test files — `as unknown as ModuleType` for dynamic imports
5. Array index access `T | undefined` — add `!` non-null assertion when `expect(arr.length).toBeGreaterThan(0)` guards it

**Established in:** M030/S01 (slice closer).

---

## TS Closure Narrowing: Destructure After Guard

**Context:** `createScopedRepairStore` in `src/knowledge/embedding-repair.ts` uses `if (!store.fn) throw` to guard optional methods, then calls `store.fn()` inside returned closures. TypeScript does not narrow closure-captured optional properties — the guard is forgotten by the time the closure executes.

**Fix:**
```ts
if (!store.fn) throw new Error(...);
const { fn } = store as Required<typeof store>;  // narrow here
return { method: () => fn() };  // closure captures the narrowed local
```

**Rule:** Whenever a guard `if (!obj.optionalMethod) throw` precedes closures that call `obj.optionalMethod`, destructure the narrowed value before the return. TypeScript's narrowing does not flow into closures.

**Established in:** M030/S01 (`src/knowledge/embedding-repair.ts`, `createScopedRepairStore`).

---

## `createMockLoggerWithArrays` Pattern for Multi-Child Handler Tests (M030/S02)

**Context:** `addon-check.test.ts` needs to assert that child loggers (created by `handlerLogger.child(...)`) emit structured info/warn bindings. A flat mock logger doesn't capture child-logger output separately; each child must write to the same shared arrays.

**Pattern:** Create a `createMockLoggerWithArrays()` factory that returns a logger stub whose `child()` method returns another stub pointing at the same `infoCalls`/`warnCalls` arrays:

```ts
function createMockLoggerWithArrays() {
  const infoCalls: unknown[] = [];
  const warnCalls: unknown[] = [];
  const logger = {
    child: () => ({ info: (...args: unknown[]) => infoCalls.push(args),
                    warn: (...args: unknown[]) => warnCalls.push(args) }),
    info: (...args: unknown[]) => infoCalls.push(args),
    warn: (...args: unknown[]) => warnCalls.push(args),
  };
  return { logger, infoCalls, warnCalls };
}
```

**Rule:** Use this pattern instead of `vi.fn()`-style mock loggers when tests need to assert on bindings emitted by child loggers. The shared arrays make assertions straightforward without needing `.mock.calls` traversal.

**Established in:** M030/S02/T02 (`src/handlers/addon-check.test.ts`).

---

## `toolNotFound` Detection in addon-check Handler — ENOENT, Not exitCode:127 (M030/S03)

**Context:** `runAddonChecker` in `src/lib/addon-checker-runner.ts` detects a missing `kodi-addon-checker` binary by catching a subprocess error whose `.code === "ENOENT"`. It returns `{ findings: [], toolNotFound: true }` on that path. A subprocess that exits with code 127 (shell "command not found") does NOT set `.code = "ENOENT"` on the error object — it falls through to the success branch and returns `{ findings: [], toolNotFound: false }`.

**Rule:** When writing tests that cover the "tool not installed" scenario, stub the subprocess to throw `Object.assign(new Error("not found"), { code: "ENOENT" })` — not to return `{ exitCode: 127 }`. The exitCode:127 path is treated as a successful run with no findings.

**Impact on upsert gate:** `upsertAddonCheckComment` is skipped only when ALL addons returned `toolNotFound: true` (guarded by `toolNotFoundCount === addonIds.length`). An exitCode:127 run doesn't increment `toolNotFoundCount`, so the upsert will be called (with an empty findings comment). Ensure the checker binary is actually present in the Docker image before relying on the skip gate.

**Established in:** M030/S03/T02 (`src/handlers/addon-check.ts`, `src/handlers/addon-check.test.ts`).

---

## Ephemeral Auth URL Pattern for Git Network Operations (M031/S02)

**Context:** After workspace.create() strips the installation token from git remote URLs, push/fetch functions no longer read credentials from `.git/config`. Instead they construct an ephemeral auth URL per command.

**Pattern:** A private `makeAuthUrl(strippedUrl, token)` helper injects `x-access-token:${token}@` into the URL for a single command, returning the URL unchanged when token is undefined. Push/fetch functions:
1. Read the stripped remote URL: `await $\`git -C ${dir} remote get-url origin\`.quiet().text().trim()`
2. Apply `makeAuthUrl(url, token)` inline to get the auth URL
3. Pass the auth URL as the remote argument directly: `git push ${authUrl} HEAD:refs/heads/${branch}`

The auth URL is constructed per-command and never stored. Callers pass `token` explicitly; the function never reads from `.git/config`.

**Exported helper for fetch sites:** `buildAuthFetchUrl(dir, token)` wraps the read+inject logic and returns `'origin'` when token is absent. Use this at inline `git fetch` call sites in handlers to avoid repeating the remote-read boilerplate.

**Fork vs base repo auth:** Fork pushes use `forkContext.botPat`; all other operations use `workspace.token` (installation token).

**Established in:** M031/S02 (`src/jobs/workspace.ts`, `buildAuthFetchUrl` export).

---

## Local Bare Repo Pattern for Git-Exercising Unit Tests (M031/S02)

**Context:** workspace.ts functions that call real `git` commands can't be tested against GitHub. Tests need a real git environment without network access.

**Pattern:**
```ts
async function setupBareAndClone(tmpDir: string): Promise<{ bareDir: string; cloneDir: string }> {
  const bareDir = path.join(tmpDir, "bare.git");
  const cloneDir = path.join(tmpDir, "clone");
  await $`git init --bare ${bareDir}`.quiet();
  // seed a commit in a temp work tree so bare has objects
  const seedDir = path.join(tmpDir, "seed");
  await $`git clone ${bareDir} ${seedDir}`.quiet();
  await Bun.write(path.join(seedDir, "README.md"), "test");
  await $`git -C ${seedDir} add .`.quiet();
  await $`git -C ${seedDir} -c user.email=t@t.com -c user.name=T commit -m init`.quiet();
  await $`git -C ${seedDir} push origin main`.quiet();
  // now clone the bare repo as the workspace
  await $`git clone ${bareDir} ${cloneDir}`.quiet();
  return { bareDir, cloneDir };
}
```

Use `file://${bareDir}` for URLs. For URL-strip tests, set the remote to a credential-bearing URL via `git remote set-url`, then strip it, then assert `git remote get-url` returns the clean URL.

**Rule:** All git-exercising tests in workspace.test.ts use this pattern. Real GitHub network calls are never made from unit tests.

**Established in:** M031/S02/T04 (`src/jobs/workspace.test.ts`, `setupBareAndClone` helper).

---

## Outgoing Secret Scan Error Format Per Server Convention (M031/S03)

**Context:** `scanOutgoingForSecrets()` is wired into 4 MCP servers + the Slack assistant handler. Each server returns errors in a different format depending on its existing convention.

**Rule:** Match the blocked-response format to each server's existing error convention:
- `comment-server.ts` — returns `{ content: [{ type: "text", text: "[SECURITY: response blocked — contained credential pattern]" }], isError: true }` (plain text, matches existing error pattern)
- `issue-comment-server.ts` — returns `{ content: [{ type: "text", text: JSON.stringify({ error_code: "SECRET_SCAN_BLOCKED", message: "..." }) }] }` (JSON, matches existing `error_code` convention)
- `review-comment-thread-server.ts` and `inline-review-server.ts` — return `{ content: [{ type: "text", text: "[SECURITY: ...]" }], isError: true }` (plain text, matches comment-server pattern)
- `assistant-handler.ts` — calls `safePublish` wrapper which substitutes `"[Response blocked by security policy]"` and still posts to Slack (no hard error; Slack publish must not silently drop)

**Rule:** Do not standardize error format across servers — preserve local convention. The `scanOutgoingForSecrets` call is always the same; only the blocked-response differs.

**Established in:** M031/S03/T02.

---

## `bun test` Requires `./` Prefix for Path-Based Filters (M031/S05)

**Context:** `bun test scripts/verify-m031.test.ts` (without `./`) treats the argument as a **filter substring** rather than a filesystem path. Bun responds with "The following filters did not match any test files" even when the file exists. This cost one full verification-gate round trip.

**Rule:** Always invoke `bun test` with a `./`-prefixed path when targeting a specific file: `bun test ./scripts/verify-m031.test.ts`. This applies to any file path passed to `bun test` — the `./` prefix is what tells Bun to treat the argument as a path.

**Established in:** M031/S05 (verification gate failure, auto-fix round 1).

---

## ACA Job Env-Var Passing Convention — `--env-vars KEY=VALUE` pairs (M032/S01)

**Context:** `az containerapp job execution start` accepts env var overrides via `--env-vars KEY=VALUE KEY2=VALUE2` (space-separated pairs). The `--env-vars` flag is NOT a JSON string — passing `--env-vars '[{"name":"K","value":"V"}]'` fails with an argument parse error.

**Pattern:**
```ts
const envArgs: string[] = spec.env.flatMap((e) => ["--env-vars", `${e.name}=${e.value}`]);
// Produces: ["--env-vars", "KEY1=val1", "--env-vars", "KEY2=val2"]
// Which Bun $ template-literal spreads correctly as separate arguments
```

**Bun $ spread:** When using `${envArgs}` in a Bun tagged-template shell expression, Bun spreads the array as separate arguments automatically. No manual `join(" ")` needed.

**Established in:** M032/S01/T01 (`src/jobs/aca-launcher.ts`, `launchAcaJob`).

---

## ACA Job Execution Status — Dual-Field Parsing (M032/S01)

**Context:** `az containerapp job execution show --output json` returns execution status in `properties.status` in some API versions and at the top-level `status` field in others.

**Rule:** Always parse both fields and prefer `properties.status` first:
```ts
const status = parsed.properties?.status ?? parsed.status ?? undefined;
```

This ensures forward compatibility when the az CLI or ACA API changes how it surfaces execution state. The normalized comparison uses `.toLowerCase()` to handle both `Succeeded` and `succeeded` variants.

**Established in:** M032/S01/T01 (`src/jobs/aca-launcher.ts`, `parseExecutionStatus`).

---

## ACA Job Contract Check Script Pattern (M032/S01)

**Context:** `scripts/test-aca-job.ts` establishes a two-phase smoke-test pattern for infrastructure scripts that require live Azure resources.

**Phase 1 — Pure-code contract check (always runs, exits 1 on failure):** Calls `buildAcaJobSpec` with synthetic inputs and asserts no `APPLICATION_SECRET_NAMES` appear in the env array. This is runnable in CI with no Azure credentials.

**Phase 2 — Live mode (skips gracefully when env vars absent):** Reads `RESOURCE_GROUP`, `ACA_JOB_NAME`, `AZURE_WORKSPACE_MOUNT` from env. If any are absent, prints a diagnostic skip message and exits 0. If all present, dispatches a real ACA Job, polls for completion, prints cold start timing in ms, and attempts to read `result.json` (non-fatal if absent — smoke-test container may not write it).

**Pattern:** Pure-code gate → live gate behind missing-env guard → non-fatal optional artifact read. Exit 0 on either pass path; exit 1 only on contract failure or live job failure.

**Established in:** M032/S01/T02 (`scripts/test-aca-job.ts`).

---

## MCP POST Requests Require `Accept: application/json, text/event-stream` Header

**Context:** `WebStandardStreamableHTTPServerTransport.handleRequest` guards POST requests against a missing or incomplete `Accept` header. If the header doesn't include both `application/json` AND `text/event-stream`, the transport returns 406 Not Acceptable immediately — before any tool dispatch.

**Rule:** When writing tests or clients that POST to a Hono+MCP route, always include:
```
Accept: application/json, text/event-stream
```

This is an MCP spec requirement (client must accept both content types because the server may respond with either JSON or SSE depending on the request type). The 406 is easy to misread as a route problem.

**Related:** Use `enableJsonResponse: true` in the transport constructor to force JSON responses (never SSE) — useful for test environments and simple RPC clients that don't need streaming.

**Established in:** M032/S02/T01 (`src/execution/mcp/http-server.test.ts`).

---

## Injectable Deps Pattern for Testing Process-Exit Code Without Module Mocking (M032/S03)

**Context:** `agent-entrypoint.ts` calls `process.exit(1)` on validation failures. Spying on `process.exit` in Bun tests is fragile — the spy may actually terminate the test process. Module mocking (`mock.module`) is not available in all Bun versions.

**Pattern:** Accept an optional `Partial<EntrypointDeps>` parameter where `EntrypointDeps` includes `queryFn`, `writeFileFn`, `readFileFn`, and `exitFn: (code: number) => never`. Production callers pass nothing (defaults apply). Test stubs inject directly:

```ts
const captured: { code?: number } = {};
const deps: Partial<EntrypointDeps> = {
  exitFn: (code: number) => { captured.code = code; return undefined as never; },
  readFileFn: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
};
await runEntrypoint(deps);
expect(captured.code).toBe(1);
```

**Key detail:** `exitFn` must have return type `never`. Test stubs satisfy this with `return undefined as never` — the TypeScript compiler accepts this cast, and the stub doesn't actually call `process.exit`.

**Why not process.exit spy:** Spying on `process.exit` can terminate the test runner if the spy is inadvertently called before the spy takes effect, or if an assertion error propagates past the spy boundary.

**Established in:** M032/S03/T02 (`src/execution/agent-entrypoint.ts`, `src/execution/agent-entrypoint.test.ts`).

---

## createTestableExecutor Pattern for ACA-Dispatching Unit Tests (M032/S03)

**Context:** `createExecutor()` in executor.ts calls `launchAcaJob`, `pollUntilComplete`, `cancelAcaJob`, `readJobResult`, and `createAzureFilesWorkspaceDir` — all I/O-bound functions that would require live Azure resources in tests.

**Pattern:** Accept optional injectable overrides as a second parameter to the executor factory (or expose `createTestableExecutor` as a named export):

```ts
export function createExecutor(deps: ExecutorDeps, fns?: Partial<ExecutorFns>) {
  const launchFn = fns?.launchFn ?? launchAcaJob;
  const pollFn   = fns?.pollFn   ?? pollUntilComplete;
  // ... etc
}
```

Tests inject stubs inline:

```ts
const executor = createExecutor(deps, {
  launchFn: async () => ({ executionName: "exec-123" }),
  pollFn:   async () => ({ status: "succeeded", durationMs: 5000 }),
  readResultFn: async () => ({ conclusion: "success", ...rest }),
  cancelFn: mock(),
  createWorkspaceDirFn: async () => "/mnt/workspaces/test-dir",
});
```

**Why not module mocking:** Bun's `mock.module` replaces a module globally for the test file, which causes test interference when multiple tests need different behaviors from the same function. The injectable pattern is per-invocation and inherently isolated.

**Established in:** M032/S03/T03 (`src/execution/executor.ts`, `src/execution/executor.test.ts`).

---

## MCP Stateless Transport: Per-Request Fresh Transport+Server Required (M032/S02)

**Context:** `WebStandardStreamableHTTPServerTransport` has a `_hasHandledRequest` flag that is set to `true` after the first request. Any attempt to reuse the same transport instance for a second request silently fails — the transport rejects it. Similarly, `McpServer.connect()` registers tool handlers and cannot be called again on the same server instance.

**Rule:** In stateless MCP HTTP mode, always call `factory()` inside the HTTP handler for every request — produce a fresh `McpSdkServerConfigWithInstance` (transport + server) per request. Never reuse transport or server instances across requests.

```ts
app.all("/internal/mcp/:serverName", async (c) => {
  const serverConfig = getFactory(serverName)(); // fresh instance every request
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await serverConfig.instance.connect(transport);
  return transport.handleRequest(c.req.raw, c.env);
});
```

**Established in:** M032/S02/T01 (`src/execution/mcp/http-server.ts`).

---

## MCP HTTP Requests Require `Accept: application/json, text/event-stream` (M032/S02)

**Context:** The MCP spec requires clients to send `Accept: application/json, text/event-stream`. Omitting this header produces a `406 Not Acceptable` from the `WebStandardStreamableHTTPServerTransport` handler. This is not prominently documented in the SDK but is enforced at the transport layer.

**Rule:** Any test or client calling the MCP HTTP server must include `Accept: application/json, text/event-stream` in the request headers.

**Established in:** M032/S02/T01 (`src/execution/mcp/http-server.test.ts` test helper).

---

## Hono Sub-App Prefix Ownership: Mount at Root (M032/S02)

**Context:** `createMcpHttpRoutes()` returns a Hono sub-app with routes already prefixed `/internal/mcp/:serverName`. Mounting at `app.route("/internal", sub)` would produce `/internal/internal/mcp/:serverName` — all requests return 404 with no error.

**Rule:** If a sub-app returned by `createFooRoutes()` already owns its full URL prefix, mount it at root: `app.route("/", createFooRoutes(...))`. Never add a prefix at the mount site if the sub-app has already baked the prefix into its routes.

**Established in:** M032/S02/T02 (`src/index.ts`).

---

## Per-Job Bearer Token Lifecycle Pattern (M032/S03)

**Context:** Each ACA job dispatch in `createExecutor()` needs an isolated authentication scope for MCP server access. The token must be alive only during the job's execution window and cleaned up regardless of success/failure/timeout.

**Pattern:**
```ts
const mcpBearerToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const ttlMs = (timeoutSeconds + 60) * 1000;
registry.register(mcpBearerToken, mcpServerFactories, Date.now() + ttlMs);
try {
  // launch job, poll, read result...
} finally {
  registry.unregister(mcpBearerToken);
}
```

**Rule:** Always unregister in a `finally` block — the token must be released on timeout, failure, and success paths. TTL = (job timeout + 60s) acts as a secondary safety net if the `finally` path has a bug.

**Established in:** M032/S03/T03 (`src/execution/executor.ts`, `createExecutor()`).

---

## `EntrypointDeps` Injectable Pattern for Process-Exit Code Testing (M032/S03)

**Context:** `src/execution/agent-entrypoint.ts` calls `process.exit(1)` on validation failures. Testing these paths without the injectable pattern would require Bun module mocking, which is fragile.

**Pattern:** Define a `Partial<EntrypointDeps>` parameter with `exitFn: (code: number) => never`. Tests inject a throwing stub; production uses `(code) => process.exit(code)`. The return type `never` ensures TypeScript understands the function does not return, which is required for branching analysis.

```ts
type EntrypointDeps = {
  queryFn: (...) => ...,
  writeFileFn: (...) => ...,
  readFileFn: (...) => ...,
  exitFn: (code: number) => never,
};

// Test stub:
const exitFn = (code: number): never => { throw new Error(`exit(${code})`); };
```

**Rule:** The `_` prefix is not used here — `EntrypointDeps` is a proper type, not a test-only override. Use this pattern whenever a module has a `process.exit` call that needs to be exercised in tests.

**Established in:** M032/S03/T02 (`src/execution/agent-entrypoint.ts` + `agent-entrypoint.test.ts`).
