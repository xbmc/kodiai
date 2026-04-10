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

---

## `az containerapp` CLI Has No `--volume` Flag — Use YAML Patch (M032/deploy)

**Context:** Both `az containerapp update` and `az containerapp job create/update` lack a `--volume` flag for Azure Files volume mounts. Passing `--volume name=...,storage-name=...,storage-type=AzureFile` produces `ERROR: unrecognized arguments`.

**Critical:** The YAML patch must include BOTH `template.volumes` AND `template.containers[].volumeMounts`. Setting only `volumes` registers the volume on the template but does NOT mount it in the container — the filesystem path will not exist, producing `EACCES: permission denied, mkdir '/mnt/...'` at runtime.

**Pattern:** Two-step approach:
1. Create/update the resource with all non-volume config via normal CLI flags.
2. Apply volume mount via a YAML patch using `--yaml` that includes both volumes and volumeMounts:

```yaml
# For container app (both volumes AND volumeMounts required):
properties:
  template:
    containers:
      - name: ca-kodiai
        image: kodiairegistry.azurecr.io/kodiai:latest
        volumeMounts:
          - volumeName: kodiai-workspaces
            mountPath: /mnt/kodiai-workspaces
    volumes:
      - name: kodiai-workspaces
        storageName: kodiai-workspaces
        storageType: AzureFile

# For ACA Job (same — both containers[].volumeMounts and volumes required):
properties:
  template:
    containers:
      - name: "caj-kodiai-agent"
        image: "kodiairegistry.azurecr.io/kodiai-agent:latest"
        volumeMounts:
          - volumeName: kodiai-workspaces
            mountPath: /mnt/kodiai-workspaces
    volumes:
      - name: kodiai-workspaces
        storageName: kodiai-workspaces
        storageType: AzureFile
```
```

**Rule:** The storage name (`storageName`) must match the name used in `az containerapp env storage set` (the environment-level Azure Files registration). The volume name (`name`) is arbitrary but must match the `volumeName` in `volumeMounts`.

**Established in:** M032 deploy (deploy.sh YAML patch sections).

---

## ACA Job Dispatch Requires REST API — `az containerapp job execution start` Doesn't Exist (M032/post-deploy)

**Context:** `az containerapp job execution start` does not exist in containerapp CLI extension ≤1.3.0b2. `az containerapp job start --env-vars` exists but does NOT pass env vars as per-execution overrides — it modifies the job template permanently and the container still boots with the job's base env (empty). Both approaches result in the container seeing no env vars.

**Fix:** Use the Azure Management REST API directly via `fetch()`:
```
POST https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.App/jobs/{jobName}/start?api-version=2024-03-01
{
  "containers": [{
    "name": "caj-kodiai-agent",
    "image": "...",
    "env": [{"name": "KEY", "value": "VALUE"}, ...]
  }]
}
```

**Token acquisition:** In ACA (production), use the managed identity IMDS endpoint: `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/`. Fall back to `az account get-access-token` for local dev. The managed identity needs `Contributor` role on the resource group (or at minimum `Microsoft.App/jobs/start/action`).

**Verified:** REST API correctly passes env vars to the running container. Job Succeeded with WORKSPACE_DIR, CLAUDE.md written, result.json written.

**Established in:** M032 post-deploy fix (`src/jobs/aca-launcher.ts`, `getAzureAccessToken()` + updated `launchAcaJob()`).

---

## Three-Layer Enforcement Pattern for Permanently Blocked Env Keys (M033)

**Context:** `GITHUB_INSTALLATION_TOKEN` was being passed to the agent container via a `githubInstallationToken` field on `BuildAcaJobSpecOpts`. It grants write access to all repos in the installation — an exfiltration risk with zero functional benefit to the agent.

**Pattern:** To permanently and verifiably block a key from reaching the agent container, apply all three enforcement layers:
1. **Runtime guard:** Add the key string to `APPLICATION_SECRET_NAMES` in `aca-launcher.ts`. The existing `buildAcaJobSpec` throw guard covers it immediately — no additional code needed.
2. **Static type removal:** Remove the optional field from `BuildAcaJobSpecOpts`. Any future caller that re-adds it gets a TypeScript compile error. Run `bun run tsc --noEmit` after removal — it will surface stale prop references in test files.
3. **No call site:** Remove the fetch that produced the value (e.g., `getInstallationToken()`) from the executor. If there is no call site that fetches the token, it genuinely cannot reach the container.

**Test pattern:** Replace `'included when provided'` tests with:
- `'is in APPLICATION_SECRET_NAMES'` — positive assertion on the constant itself
- `'always absent from spec env array'` — unconditional, not opt-dependent

**Decision D019:** This decision is marked non-revisable. If the agent ever needs an installation token, it must acquire one independently inside the container — it cannot inherit one from the orchestrator.

**Established in:** M033/S01.

---

## Security Policy Mirroring Across Two Agent Surfaces (M033/S03)

**Context:** Kodiai has two agent surfaces that carry security policy: `buildSecurityPolicySection()` in `review-prompt.ts` (for the reviewer agent) and `buildSecurityClaudeMd()` in `executor.ts` (for the executor agent via CLAUDE.md). These agents run in different processes with different context — each must carry its own policy signal independently.

**Rule:** When adding security policy language (e.g., execution-bypass guardrails), always update **both** surfaces:
- `src/execution/review-prompt.ts` → `buildSecurityPolicySection()` — bullets in the security policy array
- `src/execution/executor.ts` → `buildSecurityClaudeMd()` — section in the CLAUDE.md content

Centralizing in one surface and relying on the other to "inherit" it does not work — the review prompt is never read by the executor agent, and CLAUDE.md is never read by the reviewer.

**Test coverage:** Add tests to both `review-prompt.test.ts` and `executor.test.ts`. The `executor.test.ts` tests check `buildSecurityClaudeMd()` output directly; the review-prompt tests check `buildSecurityPolicySection()`. Tests should assert on specific signal words (e.g., `'execute'`, `'social engineering'`) rather than exact sentence text, to remain stable across phrasing tweaks.

**Established in:** M033/S03.

---

## SDKRateLimitEvent Emitted During Streaming, Not in Final Result (M034/S01)

**Context:** `SDKRateLimitEvent` arrives as a streaming message during the for-await loop in `agent-entrypoint.ts`, not in the final `ResultMessage`. To capture it, you must accumulate it inside the loop (not extract it from the result) and use a spread-conditional to populate the field only when an event was actually seen.

**Pattern:**
```ts
let lastRateLimitEvent: SDKRateLimitEvent | undefined;
for await (const message of sdk.stream(...)) {
  if (message.type === "result") { ... }
  else if (message.type === "rate_limit_event") {
    lastRateLimitEvent = message; // last-wins
  }
}
const result = {
  ...,
  ...(lastRateLimitEvent ? { usageLimit: { ... } } : {}), // absent when no event
};
```

**Rule:** Any future SDK event type that provides run-level metadata should be checked for this same streaming-vs-result-envelope distinction before assuming it appears in the final `ResultMessage`.

**Established in:** M034/S01.

---

## Spread-Conditional for Absent-vs-Present JSON Keys (M034/S01)

**Context:** Optional fields on JSON artifacts (like `result.json`) should be fully absent when not applicable — not present as `null` or `undefined`. TypeScript's optional assignment (`obj.field = value`) leaves the key present with `undefined` value; JSON.stringify then drops it, but the TypeScript type still widens to include `undefined`, creating type noise.

**Pattern:** Use spread-conditional to make the key structurally absent at the object literal level:
```ts
const obj = {
  required: "value",
  ...(condition ? { optionalField: value } : {}),
};
```
This keeps the TypeScript type narrower and avoids null/undefined noise in downstream consumers and test assertions.

**Established in:** M034/S01.

---

## Inline usageLimit Shape at Function Boundaries to Avoid Cross-Module Coupling (M034/S02)

**Context:** `formatReviewDetailsSummary` in `review-utils.ts` needs to accept a `usageLimit` param that mirrors the shape on `ExecutionResult`. Importing `ExecutionResult` from `src/execution/types.ts` into `src/lib/review-utils.ts` would create a coupling from lib → execution — acceptable today, but fragile as the modules evolve.

**Rule:** When a rendering utility needs a subset of an execution type's fields, inline the shape at the function parameter boundary rather than importing the full type. The minor duplication is worth the decoupling. Document the mapping in the call site comment if the shapes diverge.

**Established in:** M034/S02.

---

## HEAD-Based Branch Hygiene Proofs Are Commit-Sensitive (M043/S03)

**Context:** S03 used `origin/main...HEAD` and `fd67a48111...HEAD` diff proofs to confirm the rebased PR #80 branch had only the intended hotfix surface. Restoring tracked runtime files like `.gsd/event-log.jsonl` and `.gsd/state-manifest.json` in the working tree was not sufficient, because those proofs compare committed branch state. `gsd_complete_task` also re-touched the same tracked `.gsd` files as bookkeeping side effects, so they had to be restored back to `HEAD` before the final audit stayed clean.

**Rule:** When a task or slice uses `...HEAD` diff proofs, cleanup of tracked runtime/planning files must be recorded in a real commit before rerunning the proof. After any `gsd_*complete*` step, re-check tracked `.gsd` files if they are part of the branch delta — the completion tooling may update them as side effects.

**Established in:** M043/S03/T04.

---

## Structural-Impact Prompt Status Must Mirror Breaking-Change Status (M043/S04)

**Context:** `buildStructuralImpactPromptSection()` and `buildBreakingChangeEvidenceInstructions()` both describe the same structural-impact payload in `src/execution/review-prompt.ts`. A live PR-review defect appeared when the structural section hardcoded `evidence-present` while the breaking-change section already used `partial-evidence` for `status: "partial"` payloads.

**Rule:** Any prompt surface that summarizes structural impact must derive its status string from `structuralImpact.status` using the same contract: `partial` -> `partial-evidence`, everything else with renderable evidence -> `evidence-present`. Do not hardcode the structural status line independently of the breaking-change helper.

**Testing pattern:** Assert on the structural section itself, not only the breaking-change helper. In `src/execution/review-prompt.test.ts`, extract the `## Structural Impact Evidence` section and require the partial-status wording there while preserving the rendered caller/file/test/evidence counters.

**Established in:** M043/S04/T01.

---

## Active-Rules `totalActive` Is a Lower Bound When Prompt Injection Is Capped (M043/S04)

**Context:** `getActiveRulesForPrompt()` in `src/knowledge/active-rules.ts` fetches `effectiveLimit + 1` rows so it can detect capping without a separate `COUNT(*)`. When the result is capped, `totalActive` is therefore the fetched lower bound (`effectiveLimit + 1`), not the exact store total.

**Rule:** Tests and callers must treat capped `totalActive` as a lower-bound signal, not an exact count. To prove the capped path, stub `getActiveRulesForRepo()` with at least `effectiveLimit + 1` rows and assert that `totalActive === effectiveLimit + 1` while only `effectiveLimit` rules are injected.

**Established in:** M043/S04/T02 (`src/knowledge/active-rules.test.ts`).

---

## Canonical Backfill Resume Ordering Must Follow `localeCompare`, Including Non-ASCII Paths (M043/S04)

**Context:** `listFilesRecursive()` and `shouldResumeFromPath()` in `src/knowledge/canonical-code-backfill.ts` both use `localeCompare()` for canonical file ordering and resume checkpoint comparisons. ASCII-only fixtures can hide ordering bugs when filenames contain accented characters.

**Rule:** Resume tests for canonical backfill must build expectations from the same `localeCompare()` ordering the production code uses, and should include non-ASCII filenames (for example `éclair.ts` or `ångström.ts`) so checkpoint behavior is proven against real collation-sensitive inputs. Do not assume byte-order or plain ASCII sorting when asserting resumed file sets.

**Established in:** M043/S04/T02 (`src/knowledge/canonical-code-backfill.test.ts`).

---

## BIGINT Comment IDs Read Back as Strings from Raw SQL Rows (M043/S05)

**Context:** `032-bigint-comment-ids.sql` promotes `findings.comment_id` (and sibling comment-id columns) from `INTEGER` to `BIGINT`. In the CI-shaped Postgres lane, direct `sql` reads of `comment_id` now come back as string values like `"1234"`, not numeric `1234`, even when the inserted input was a number.

**Rule:** When tests or one-off diagnostics read `comment_id` / `partial_comment_id` directly from raw SQL rows after the bigint migration, treat the value as stringly typed unless the caller normalizes it explicitly. Assertions should either compare against the string form or coerce with `Number(...)` before comparing.

**Why it matters:** Store-layer code that passes bigint IDs through raw row objects can fail deterministic tests with type-only mismatches even though the persisted value is correct. The first post-S05 red in `src/knowledge/store.test.ts` was exactly this shape.

**Established in:** M043/S05/T01 (`src/knowledge/store.test.ts`, `src/db/migrations/032-bigint-comment-ids.sql`).

---

## Explicit `@kodiai review` Must Use Review-Class Turns and Tools, Not Conversational Mention Caps (M043/S05)

**Context:** The fresh production proof delivery `bab62150-3329-11f1-96a5-aecd0f6e5943` initially reproduced a pre-publish gap only because explicit PR review mentions inherited the read-only mention budget: the agent workspace showed `taskType: "review.full"` but `maxTurns: 12` plus the reduced mention tool set (`Read`, `Grep`, `Bash(git diff:*)`, `Bash(git status:*)`). A prior live run ended with `conclusion: "failure"`, `stopReason: "tool_use"`, and no publish markers because the agent exhausted the conversational mention budget before it could publish.

**Rule:** When `mention.ts` promotes a PR mention to `taskType="review.full"`, it must also inherit the **full review execution budget**:
- `maxTurnsOverride` must be `undefined` so executor falls back to repo-config `maxTurns` (currently 25), not the 12/20 turn mention cap.
- Executor must not classify that run as a reduced-tool "read-only PR mention". Explicit review mentions need the normal review tool surface (`Glob`, `Bash(git log:*)`, `Bash(git show:*)`, etc.), not the conversational mention subset.

**Operational proof:** After deploying this fix to revision `ca-kodiai--0000076`, the next fresh explicit review delivery on PR #80 completed with:
- `reviewOutputPublicationState=publish`
- `publishResolution=approval-bridge`
- GitHub review `@kodiai[bot]: APPROVED`
- `result.json` showing `conclusion: "success"`, `stopReason: "end_turn"`

**Testing pattern:**
- In `src/handlers/mention.test.ts`, capture `maxTurnsOverride` for `@kodiai review` and assert it is `undefined`.
- In `src/execution/executor.test.ts`, assert explicit review mentions (`eventType="issue_comment.created"`, `taskType="review.full"`, PR context) write `agent-config.json` with repo-config `maxTurns` and the full review tool set, while conversational mention requests still get the reduced tool set.

**Established in:** M043/S05 post-close remediation (`src/handlers/mention.ts`, `src/execution/executor.ts`).

---

## Clean-DB CI Repros Must Start From a Fresh Database, Not the Warm `kodiai` DB (M043/S05)

**Context:** PR #80 still failed in GitHub Actions after the deterministic and live mention-review fixes landed. The rerun exposed a hidden local false positive: `src/knowledge/store.test.ts` was passing only because the developer DB already had migrated tables. On a fresh CI database, the suite failed immediately with `PostgresError: relation "review_checkpoints" does not exist` from `truncateAll()` before the first `KnowledgeStore` assertion even ran.

**Rule:** For any DB-shaped CI repro, prove the failure or fix against a **freshly created database** (for example `kodiai_ci_repro`), not just the long-lived local `kodiai` database. A warm local DB can hide missing test bootstrap. If a test file opens a direct `postgres(...)` connection, verify it explicitly runs `runMigrations(sql)` in `beforeAll` unless the schema is created some other way.

**Concrete fix pattern:** Store/integration tests that own a Postgres connection should follow the same bootstrap pattern as `memory-store.test.ts`, `issue-store.test.ts`, and similar peers:
```ts
import { runMigrations } from "../db/migrate.ts";

beforeAll(async () => {
  sql = postgres(DATABASE_URL, ...);
  await runMigrations(sql);
  store = createKnowledgeStore({ sql, logger: mockLogger });
});
```

**Established in:** M043/S05 clean-DB rerun after PR #80 CI surfaced `review_checkpoints` schema drift (`src/knowledge/store.test.ts`).

---

## `reviewOutputKey` Retry Suffix Maps to Retry Delivery ID (M044/S01)

**Context:** Automatic review retries in `src/handlers/review.ts` do not rebuild the key from scratch. They derive the retry key by appending `-retry-1` to the base `reviewOutputKey`, and they derive the retry delivery ID by appending the same suffix to the base webhook delivery ID (`${event.id}-retry-1`).

**Rule:** When correlating retry-published review output, parse the base key first, then treat the retry suffix as a separate dimension:
- `baseReviewOutputKey` = original marker-backed key without `-retry-N`
- `retryAttempt` = `N`
- `deliveryId` = base delivery from the key payload
- `effectiveDeliveryId` = `${deliveryId}-retry-${retryAttempt}` when `retryAttempt` is present

Do **not** treat the full retry-suffixed key as if it encoded a different base delivery payload. The suffix is transport-level retry identity layered on top of the same repo/PR/action/head key.

**Established in:** M044/S01/T01 (`src/handlers/review-idempotency.ts`, `src/handlers/review-idempotency.test.ts`, `src/handlers/review.ts`).

---

## Recent Review Audits Must Recognize `kodiai:review-details` Markers (M044/S01)

**Context:** Automatic clean reviews can legitimately publish only a standalone Review Details issue comment. That comment carries `<!-- kodiai:review-details:${reviewOutputKey} -->`, not the `kodiai:review-output-key:` marker used for summary comments and idempotency scans.

**Rule:** Any retrospective review-audit collector that samples GitHub-visible Kodiai output must extract review identity from **both** marker shapes:
- `<!-- kodiai:review-output-key:${reviewOutputKey} -->`
- `<!-- kodiai:review-details:${reviewOutputKey} -->`

If the collector only looks for `review-output-key`, it will silently miss valid clean-review outcomes on the automatic lane and bias the audit toward finding-bearing cases.

**Established in:** M044/S01/T03 (`src/handlers/review-idempotency.ts`, `src/review-audit/recent-review-sample.ts`, `src/handlers/review.ts`).

---

## Azure `Evidence bundle` Outcome Is a Valid Automatic-Lane Audit Signal (M044/S02)

**Context:** When DB-backed review evidence is unavailable, recent automatic-review classifications can still be resolved from Azure `ContainerAppConsoleLogs_CL` rows. The review handler emits `evidenceType="review"` with `outcome="submitted-approval"` for clean approval paths and `outcome="published-output"` when findings output was published.

**Rule:** For recent-review auditing, treat these Azure evidence-bundle outcomes as first-class internal publication signals:
- `submitted-approval` -> `clean-valid`
- `published-output` -> `findings-published`

These log outcomes should take precedence over DB fallbacks when they are present for the same `reviewOutputKey` / effective delivery identity. If Azure rows are absent or contradictory, fail open to `indeterminate` rather than guessing.

**Related explicit-lane rule:** `Mention execution completed` with `publishResolution` drives explicit mention-review classification (`approval-bridge`, `idempotency-skip`, `duplicate-suppressed`, `publish-failure-*`).

**Established in:** M044/S02/T02 (`src/review-audit/log-analytics.ts`, `src/review-audit/evidence-correlation.ts`, `scripts/verify-m044-s01.ts`).

---

## Contributor profile lookups hide opted-out rows unless callers opt in (M045/S01)

**Context:** `ContributorProfileStore.getByGithubUsername()` filters out opted-out profiles by default. That is correct for user-facing lookups, but review-time/system code that needs to distinguish `generic-opt-out` from `generic-unknown` will silently miss opted-out contributors unless it explicitly requests the system-view path.

**Rule:** For review-time or other internal contract resolution, call:
```ts
profileStore.getByGithubUsername(login, { includeOptedOut: true })
```
Then treat `profile.optedOut === true` as a generic contract outcome, not as permission to resume profile-backed personalization. Leave the default lookup behavior unchanged for user-facing call sites.

**Established in:** M045/S01/T01 (`src/contributor/types.ts`, `src/contributor/profile-store.ts`, `src/handlers/review.ts`).

---

## Runtime review prompts must pass `contributorExperienceContract`; `authorTier` is legacy-only (M045/S01)

**Context:** `buildReviewPrompt()` still accepts `authorTier` because older verifier/script callers outside the runtime review path were not migrated in T02. But the truthful GitHub review runtime now derives author-experience wording from `contributorExperienceContract.promptPolicy`, not from raw tiers.

**Rule:** In runtime review code (`src/handlers/review.ts` and any future rebuild/retry paths), always pass the full `contributorExperienceContract` object and never rely on `authorTier` for prompt shaping. The `authorTier` parameter is a compatibility path for non-runtime callers only; using it in live review flow reintroduces prompt/details drift, especially for coarse fallback and generic states.

**Established in:** M045/S01/T02 (`src/contributor/experience-contract.ts`, `src/execution/review-prompt.ts`, `src/handlers/review.ts`).

---

## RET-07 test fixtures must not use `author:` as the only intent-variant discriminator after generic hint suppression (M045/S02)

**Context:** Before S02/T01, review retrieval always leaked a raw tier into the intent query, so RET-07 tests could infer the intent variant by checking for `author:`. Once generic contract states correctly emit no retrieval hint, the intent and code-shape queries can become textually identical for minimal PR fixtures, which makes that heuristic wrong and hides real regressions.

**Rule:** In retrieval orchestration tests, identify intent/file-path/code-shape variants without depending on leaked contributor text. Use deterministic call order or explicit fixture signals instead of assuming the intent query always contains `author:`.

**Established in:** M045/S02/T01 (`src/handlers/review.test.ts`).

---

## Reset in-memory cache state explicitly in tests for Slack identity suggestions (M045/S02)

**Context:** `src/handlers/identity-suggest.ts` caches the Slack member list for one hour and remembers GitHub usernames it has already suggested. Without an explicit reset seam, unit tests bleed state across cases: later tests may skip `users.list`, suppress DMs, or silently stop exercising failure paths depending on execution order.

**Rule:** Stateful modules with in-memory caches should expose a narrow test reset helper when deterministic per-test isolation matters. For `identity-suggest.ts`, call `resetIdentitySuggestionStateForTests()` in test setup/teardown before asserting Slack fetch order or fail-open behavior.

**Established in:** M045/S02/T02 (`src/handlers/identity-suggest.ts`, `src/handlers/identity-suggest.test.ts`).

---

## Cross-surface verifier expectations must stay independent from the helpers they validate (M045/S03)

**Context:** `scripts/verify-m045-s03.ts` composes the existing S01 GitHub proof report and also validates retrieval, Slack, and identity-link wording. If the verifier derives its expected phrases by calling the same projection/helper logic under test, drift can go false-green because both the implementation and the verifier change together.

**Rule:** When building an operator-facing drift verifier around existing surfaces, preserve upstream verifier reports intact as nested evidence and keep the new surface expectations local to the verifier. For S03 this means: embed the full S01 report with its original check IDs/status codes, but author retrieval/Slack/identity required and banned phrases directly in the S03 fixture matrix instead of regenerating them from the same helper path being checked.

**Established in:** M045/S03 (`scripts/verify-m045-s03.ts`, `scripts/verify-m045-s03.test.ts`).

---

## Nullable contract projections are the cleanest suppression seam for generic contributor states (M045/S02)

**Context:** Retrieval builders originally assumed contributor context would always become text. Once M045 introduced truthful generic states, placeholder strings would have reintroduced hidden semantics and made downstream query/tests drift-prone. S02 solved this by projecting an optional `authorHint` from the contributor-experience contract: profile-backed and coarse-fallback states emit a normalized hint, while generic states emit `null` and the query builders omit the clause entirely.

**Rule:** When a product contract says a signal is absent by design, project that absence as `null`/`undefined` through the downstream seam and let the consumer omit the feature entirely. Do not substitute placeholder generic text just to keep an old API shape alive — that recreates drift and makes tests depend on accidental wording.

**Established in:** M045/S02/T01 (`src/contributor/experience-contract.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/knowledge/retrieval-query.ts`).

---

## Checked-in xbmc snapshots must derive `generatedAt` from evidence, not wall clock (M046/S01)

**Context:** `src/contributor/xbmc-fixture-refresh.ts` writes a checked-in proof artifact. If `generatedAt` comes from `new Date().toISOString()`, two refreshes with identical evidence produce different snapshot bytes, which breaks the deterministic refresh contract and creates meaningless drift in `fixtures/contributor-calibration/xbmc-snapshot.json`.

**Rule:** When `refreshXbmcFixtureSnapshot()` is called without an explicit `generatedAt`, derive it deterministically from the latest non-null `provenanceRecords[].observedAt` timestamp across retained and excluded contributors, with `manifest.curatedAt` as the fallback when no observed timestamps exist. Do not reintroduce wall-clock defaulting for checked-in fixture artifacts.

**Established in:** M046/S01/T03 (`src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-refresh.test.ts`).

---

## Live xbmc fixture refresh must bound GitHub evidence collection and degrade explicitly on timeout (M046/S01)

**Context:** `refreshXbmcFixtureSnapshot()` can run with GitHub App credentials auto-loaded by Bun from `.env`. Without an explicit request timeout, a slow GitHub API call can stall `bun run verify:m046:s01 -- --refresh --json` indefinitely, turning an operator proof command into a hanging workflow.

**Rule:** When fixture refresh performs live GitHub enrichment, pass explicit `requestTimeoutMs` through the GitHub App seam and convert timeout failures into named degraded refresh failures (for example `github-timeout`) instead of hanging or aborting the whole snapshot build. Preserve any local-git evidence that was already collected.

**Established in:** M046/S01/T02 (`src/auth/github-app.ts`, `src/contributor/xbmc-fixture-refresh.ts`).

---

## Local git shortlog ingestion should ignore malformed rows unless the whole shortlog is unusable (M046/S01)

**Context:** `git shortlog -sne --all` output can include malformed lines that do not match the expected `count name <email>` shape. Treating one bad row as a fatal error would degrade an otherwise valid fixture snapshot and silently discard useful contributor evidence.

**Rule:** Parse local shortlog rows one-by-one. Ignore malformed rows, keep any rows that parse successfully, and mark local-git evidence unavailable only when the command fails or when no rows in the entire shortlog are parseable.

**Established in:** M046/S01/T02 (`src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-refresh.test.ts`).

---

## Checked-in xbmc snapshots need both shape validation and fixture-manifest semantic validation (M046/S02)

**Context:** A full snapshot can satisfy the JSON/Zod shape while still violating fixture semantics that S02 depends on, such as duplicate `normalizedId` values across retained and excluded rows. Those semantic failures only appear when the snapshot is projected back through the shared fixture-manifest validator.

**Rule:** Do not treat successful full-schema parsing as sufficient proof that an xbmc snapshot is valid. Always run the projected retained/excluded rows back through `assertValidFixtureManifest(...)` as part of snapshot validation, and fail the snapshot on those semantic errors instead of only failing downstream report logic.

**Established in:** M046/S02/T01 (`src/contributor/xbmc-fixture-snapshot.ts`, `scripts/verify-m046-s01.ts`).

---

## Zero-score contributor ties can move percentile rank without changing the newcomer contract (M046/S02)

**Context:** `calculateTierAssignments(...)` is percentile-based, so tied scores usually create order sensitivity in small cohorts. But `tierFromPercentile(...)` has a special-case override: any `overallScore === 0` is always `newcomer` regardless of percentile. In calibration work this means a three-way zero-score tie can permute ranks 1..3 while every contributor still projects to the same `profile-backed` newcomer contract.

**Rule:** When reporting calibration instability for snapshot-only contributor models, distinguish **rank instability** from **contract instability**. A zero-score tie should still be flagged as score/rank compression, but downstream verifiers should not claim tier drift if every tied row remains `newcomer` under the zero-score override.

**Established in:** M046/S02/T02 (`src/contributor/calibration-evaluator.ts`, `src/contributor/tier-calculator.ts`).

---

## Prerequisite-gated proof harnesses should keep loadable artifact diagnostics visible even when they skip the main verdict (M046/S02)

**Context:** `verify:m046:s02` depends on `verify:m046:s01`. If the harness hard-fails immediately on the prerequisite, operators lose the most useful debugging evidence: whether the checked-in snapshot still parses, loads, and preserves retained/excluded counts. That makes it harder to distinguish "fixture contract broken" from "fixture file itself is unreadable."

**Rule:** For proof harnesses with prerequisite verifiers, run the prerequisite first but still inspect any local artifact that can be loaded safely. Surface those artifact diagnostics in the report, emit a named prerequisite failure status code, and skip the downstream evaluator or final verdict until the prerequisite passes.

**Established in:** M046/S02/T03 (`scripts/verify-m046-s02.ts`, `scripts/verify-m046-s02.test.ts`).

---

## `bun test` can ignore one missing file filter if other file paths still match (M046/S03)

**Context:** During S03/T01, `bun test ./scripts/verify-m046.test.ts` failed immediately because the file does not exist yet, but the broader slice command `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts` still exited 0 and ran the four existing files. Bun treated the missing `./scripts/verify-m046.test.ts` argument as an unmatched filter while happily executing the remaining matches.

**Rule:** When a slice verification command mixes existing test paths with a not-yet-created file, do not treat a zero exit code as proof that every requested file ran. Probe any suspected missing path with its own `bun test ./path/to/file.test.ts` command before declaring the full suite complete.

**Established in:** M046/S03/T01 (`bun test` verification behavior while `scripts/verify-m046.test.ts` was still absent).

---

## Integrated proof harnesses should preserve nested evidence and report negative domain verdicts as data, not failures (M046/S03)

**Context:** `verify:m046` composes the S01 fixture verifier and S02 calibration verifier into one milestone-closeout surface. The truthful domain outcome is currently `replace`, but that recommendation is not the same thing as a broken verifier. If the harness exits non-zero just because the recommendation is negative, automation cannot distinguish "the system should change" from "the proof surface is malformed."

**Rule:** When building milestone-closeout proof harnesses, preserve the nested prerequisite reports intact, add dedicated top-level checks for composition health, and treat `keep`/`retune`/`replace` as machine-readable verdict data. Reserve non-zero exits for malformed nested evidence, count drift, missing recommendations, or contradictory change-contract state — not for a truthful negative recommendation.

**Established in:** M046/S03/T02 (`scripts/verify-m046.ts`, `src/contributor/calibration-change-contract.ts`).
