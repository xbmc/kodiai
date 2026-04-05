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

## Canonical C++ Chunking Uses Block Fallback Only When No Symbols Exist (M041/S01)

**Context:** `chunkCanonicalCodeFile()` in `src/knowledge/canonical-code-chunker.ts` handles brace languages (C++, TypeScript, JavaScript) with two distinct fallback modes, and a first-pass test expectation got this wrong for symbol-poor C++ input.

**Rule:** For brace languages, emit a `block` chunk **only when no function/class boundary is discovered at all**. If symbol chunks do exist, emit those symbol chunks plus a `module` remainder chunk for unconsumed lines. Do not collapse a partially-symbolic file into a single block chunk just because some lines remain outside symbols.

**Implication for tests:** When validating symbol-poor C++ fixtures, assert `boundaryDecisions: ["block"]` only for files with zero detected class/function boundaries. For mixed files, expect symbol boundaries plus optional `module`, not `block`.

**Established in:** M041/S01/T02 (`src/knowledge/canonical-code-chunker.ts`, `src/knowledge/canonical-code-chunker.test.ts`).

---

## Full-Shape Fixture Overrides for Proof-Harness Tests (M041/S02)

**Context:** `scripts/verify-m041-s02.test.ts` uses `makeFixtureResult()` plus nested `Partial<M041S02ProofFixtureResult>` overrides. TypeScript accepts the top-level partial, but nested objects like `backfill` and `retrieval` are still checked against the full concrete field set when passed inline.

**Rule:** When overriding nested proof-fixture objects in tests, provide the **full nested shape**, not just the changed fields. For example, a retrieval override that only wants `canonicalRefRequested: "main"` must still include `canonicalCodeCount`, `snippetCount`, `unifiedSources`, `topUnifiedSource`, `topUnifiedLabel`, `topCanonicalFilePath`, `topSnippetFilePath`, and `contextWindow`.

**Pattern:** Keep `makeFixtureResult()` responsible for merging, but make each inline nested override structurally complete. This avoids repeated TS2739/TS2740 errors in Bun/tsc without introducing a custom deep-partial helper type.

**Established in:** M041/S02 slice closure (`scripts/verify-m041-s02.test.ts`).

---

## Ephemeral Auth URL Pattern for Git Network Operations (M031/S02)

**Context:** After workspace.create() strips the installation token from git remote URLs, push/fetch functions no longer read credentials from `.git/config`. Instead they construct an ephemeral auth URL per command.

**Pattern:** A private `makeAuthUrl(strippedUrl, token)` helper injects `x-access-token:${token}@` into the URL for a single command, returning the URL unchanged when token is undefined. Push/fetch functions:
1. Read the stripped remote URL: `await $`git -C ${dir} remote get-url origin`.quiet().text().trim()`
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

## TEST_DATABASE_URL-Gated DB Suites Should Skip, Not Probe DATABASE_URL (M040/S01)

**Context:** `src/review-graph/store.test.ts` originally behaved like a DB-backed integration suite but inherited environment behavior that still let verification fail in auto-mode when `DATABASE_URL` pointed at an unreachable host. The slice stabilized this by following the repo's explicit `TEST_DATABASE_URL` gating pattern already used by other Postgres-backed suites.

**Rule:** For DB integration tests, gate the entire suite with `describe.skipIf(!process.env.TEST_DATABASE_URL)` and connect only through `TEST_DATABASE_URL`. Do not silently fall back to `DATABASE_URL` or attempt opportunistic live connections during verification.

**Why:** Auto-mode and CI environments may carry a production-like `DATABASE_URL` that is intentionally unreachable or unsuitable for tests. An explicit `TEST_DATABASE_URL` contract keeps verification deterministic: configured test DB -> run the suite; no test DB -> clean skip.

**Established in:** M040/S01 (`src/review-graph/store.test.ts`), matching existing patterns in `src/knowledge/*store.test.ts`.

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

## Generated-Rule Lifecycle Module Pattern (M036)

**Context:** M036 added four coordinated modules implementing the pending→active→retired lifecycle for generated rules. The pattern is now established and should be followed exactly when adding future policy stages.

**Pattern — pure predicate + env config + fail-open orchestrator:**
```ts
// Pure predicate (no I/O, trivially testable)
export function shouldRetireRule(signalScore: number, memberCount: number, opts?: { floor?: number; minMemberCount?: number }): { retire: boolean; reason?: string } { ... }

// Env config read at call time (not module load), explicit param override
export function getRetirementFloor(): number { return parseFloat(process.env.GENERATED_RULE_RETIREMENT_FLOOR ?? "0.3"); }

// Fail-open orchestrator: counts transitions, logs per-decision + run-summary, wraps each store call in try/catch
export async function applyRetirementPolicy({ store, logger, repo }: RetirementPolicyOpts): Promise<RetirementPolicyResult> { ... }
```

**Rule:** The `shouldAutoActivate` / `shouldRetireRule` pattern is the canonical shape for any future lifecycle predicate. Keep predicates free of I/O so they are unit-testable without stubs. Orchestrators are always fail-open — each store call in its own try/catch, failures increment a counter and log warn, never throw.

**Established in:** M036/S02 (activation), M036/S03 (retirement).

---

## LifecycleNotifyHook — Extension Point for External Push (M036/S03)

**Context:** `generated-rule-notify.ts` exposes a `LifecycleNotifyHook` callback that the caller can inject to receive lifecycle events. This is the extension point for Slack/GitHub notifications.

**Pattern:**
```ts
type LifecycleNotifyHook = (events: LifecycleEvent[]) => Promise<void> | void;

// Hook is skipped when event count is 0
// Hook failures are caught, surface as notifyHookFailed: true on result, no throw
// Hook receives all events in a single batch call
```

**Rule:** When implementing a concrete Slack hook, wrap the Slack API call inside the hook callback — do not add Slack API calls directly into the notify functions. The fail-open catch isolation and hookCallCount assertion pattern in tests must be preserved when extending. Future hooks (GitHub, PagerDuty, etc.) follow the same shape.

**Established in:** M036/S03/T02.

---

## Non-Downgrading Upsert for Lifecycle-Tracked Records (M036/S01)

**Context:** Proposal sweeps re-run over evolving learning-memory clusters. If a rule was manually activated or retired, a subsequent sweep run should not regress it back to pending.

**SQL Pattern:**
```sql
INSERT INTO generated_rules (repo, title, ..., status, ...)
VALUES ($1, $2, ..., 'pending', ...)
ON CONFLICT (repo, title) DO UPDATE SET
  rule_text = EXCLUDED.rule_text,
  signal_score = EXCLUDED.signal_score,
  -- status: only update if currently pending — never downgrade active or retired
  status = CASE
    WHEN generated_rules.status = 'pending' THEN EXCLUDED.status
    ELSE generated_rules.status
  END,
  updated_at = NOW()
```

**Rule:** Any table that has a `pending/active/retired` (or similar) lifecycle column and is populated by an automated sweep must use this CASE guard on the status column. Never UPDATE status unconditionally from a sweep upsert.

**Established in:** M036/S01/T01 (035-generated-rules.sql, GeneratedRuleStore.savePendingRule).

---

## Float32Array → JSONB Centroid Round-Trip (M037/S01)

**Context:** `suggestion_cluster_models` stores centroids as JSONB `number[][]`. `buildClusterModel` produces `Float32Array[]` from HDBSCAN output. JSON.stringify converts Float32Arrays to `{"0":…,"1":…}` objects, not arrays — the round-trip silently loses the array shape.

**Fix:** Explicitly convert before serializing:
```ts
const positive_centroids = model.positiveCentroids.map(c => Array.from(c));
const negative_centroids = model.negativeCentroids.map(c => Array.from(c));
// JSON.stringify(positive_centroids) → [[0.1, 0.2, ...], ...]
```

And restore on read:
```ts
const positiveCentroids = (row.positive_centroids as number[][]).map(c => new Float32Array(c));
```

**Rule:** Any code that serializes typed arrays (Float32Array, Int32Array, etc.) to JSONB must call `Array.from(typedArray)` before stringification. The store tests cover this via the `centroid serialization round-trip` describe block.

**Established in:** M037/S01/T01 (`suggestion-cluster-store.ts`, `saveModel`/`getModel`).

---

## Background Cluster Refresh: Injectable `_buildFn` + Sequential Sweep (M037/S01)

**Context:** `createClusterRefresh` runs a background sweep that calls `buildClusterModel` for each expired repo. Tests need to exercise the sweep logic (maxReposPerRun cap, fail-open, mixed outcomes) without a real DB or HDBSCAN run.

**Pattern:** Accept an optional `_buildFn?: typeof buildClusterModel` on the refresh options. Tests inject a synchronous stub. Production callers omit it (the real import is used). This is the same injectable-fn pattern as `createClusterRefresh`'s cousins in M032/S03 (`createTestableExecutor`) — use it whenever a background sweep calls a slow or side-effecting function.

**Sequential over parallel:** The sweep is background work and there is no urgency to parallelize. Sequential iteration (for-of) is simpler, keeps logs ordered per-repo, and prevents thundering-herd DB load when the expired list is large. Do not parallelize unless latency benchmarks justify it.

**Established in:** M037/S01/T03 (`suggestion-cluster-refresh.ts`, `createClusterRefresh`).

---

## Safety-Guard Symmetry: Block Both Suppression AND Boosting for Protected Findings (M037/S02)

**Context:** `isFeedbackSuppressionProtected` was originally used only to guard against suppressing CRITICAL/MAJOR-security/MAJOR-correctness findings. M037/S02 extended this guard to also block confidence boosting on those same findings.

**Rule:** Any logic that reads cluster scoring signals (suppress or boost) must check `isFeedbackSuppressionProtected(severity, category)` and skip **both** the suppress path and the boost path when the guard fires. Raising confidence on a CRITICAL finding via historical positive signal is as unsafe as suppressing it — do not split the guard.

**Pattern:** In `scoreFindingEmbedding` and `applyClusterScoreAdjustment`, the guard check comes before the suppress/boost branch, not inside each branch separately. This ensures the guard is a single checkpoint rather than two independent checks that could diverge.

**Established in:** M037/S02/T01 (`suggestion-cluster-scoring.ts`, `scoreFindingEmbedding`) and M037/S02/T02 (`confidence-adjuster.ts`, `applyClusterScoreAdjustment`).

---

## Sequential EmbeddingProvider Stub for Multi-Finding scoreFindings() Tests (M037/S02)

**Context:** `scoreFindings()` calls an EmbeddingProvider once per finding. Tests that exercise multi-finding scenarios need the stub to return different embeddings per call — a static single-return mock won't work.

**Pattern:**
```ts
const embeddingQueue: (number[] | null)[] = [vec1, vec2, null];
let embeddingCallIdx = 0;
const provider: EmbeddingProvider = {
  model: "voyage-4",
  dimensions: 4,
  embed: mock(async () => {
    const v = embeddingQueue[embeddingCallIdx++];
    return v ? { embeddings: [v] } : null;
  }),
};
```

**Rule:** The stub must satisfy the full `EmbeddingProvider` interface shape — `model` and `dimensions` are required properties on the object, not just the `embed` method. Omitting them produces a TypeScript compile error when the interface is strict.

**Return null to simulate embedding failure:** returning `null` from the mock causes `scoreFindings()` to apply the fail-open path (no signal, `clusterModelUsed` still true but individual finding gets zero adjustment).

**Established in:** M037/S02/T03 (`verify-m037-s02.test.ts`, sequential embedding fixture pattern).

---

## Staleness-Aware Cluster Scoring Must Preserve Degradation Reason Codes (M037/S03)

**Context:** `resolveModelForScoring()` is the only place that applies the cluster-model grace-period policy (`fresh` / `stale` / `very-stale` / `missing`). But `applyClusterScoringWithDegradation()` also needs to preserve the coarser review-surface reason codes (`model-load-error` vs `no-model`) used by runtime logs, tests, and proof harnesses.

**Pattern:** Route the live scoring wrapper through `resolveModelForScoring()` rather than calling `store.getModel()` directly, and carry a small sentinel on the resolver result:
```ts
const resolved = await resolveModelForScoring(repo, store, logger);
if (resolved.storeReadFailed) return noOpResult(findings, "model-load-error");
if (!resolved.model) return noOpResult(findings, "no-model");
```
This keeps the staleness policy centralized while still distinguishing "DB/store read failed" from "no usable model after policy".

**Rule:** Any caller that wants stale-grace behavior must go through `resolveModelForScoring()` (or `evaluateModelStaleness()` + equivalent policy logic). Do not call `store.getModel()` from live scoring code — that bypasses the grace window and silently drops stale-but-still-usable models.

**Established in:** M037/S03/T03 (`suggestion-cluster-staleness.ts`, `suggestion-cluster-degradation.ts`, `verify-m037-s03.ts`).

---

## Verifier-Driven Milestone Closure Should Re-Run Slice Harnesses, Not Just Trust Prior Summaries (M037)

**Context:** M037 milestone completion depended on three machine-verifiable slice harnesses (`verify:m037:s01`, `verify:m037:s02`, `verify:m037:s03`). Slice summaries were useful evidence, but milestone closure still needed a fresh rerun to prove the assembled system remained intact at close-out time.

**Rule:** When a milestone ships explicit proof harnesses, the milestone closer should rerun them during closure instead of relying only on historical task or slice summaries. Milestone verification should treat fresh harness output as the authoritative closure signal and use summaries as supporting evidence.

**Pattern:** Verify real code exists, verify slice artifacts exist, then rerun the milestone's slice-level proof commands and cite concrete check IDs/status codes in the milestone summary. If the harness exposes a mismatch, fix the live path rather than weakening the verifier.

**Established in:** M037 milestone closure (`verify:m037:s01`, `verify:m037:s02`, `verify:m037:s03`).

---

## `queryBlastRadiusFromSnapshot` Edge Weight + Confidence Scoring Model (M040/S02)

**Context:** `queryBlastRadiusFromSnapshot` in `src/review-graph/query.ts` walks workspace graph edges to produce ranked impacted files, probable dependents, and likely tests. Edge weights are empirically tuned to reflect impact probability:
- `calls`: 0.92 (highest — symbol-level call dependency)
- `tests`: 0.88 (explicit test→symbol edge)
- `references`: 0.55
- `imports`/`includes`: 0.42
- `declares`: 0.15 / `contains`: 0.2

**Score formula:** `EDGE_WEIGHT[edgeKind] × edgeConfidence × seedConfidence × (1 + KIND_BONUS[nodeKind])`. Node-kind bonuses are: symbol: 0.15, test: 0.1, callsite: 0.05, import: 0.03. Multiple signals for the same file accumulate additively.

**Bounded heuristic fallback:** When no direct graph edges exist, the query also scans import nodes (score: 0.38×conf), callsite nodes (0.62×conf), and test nodes (0.7×conf) for name-based matches to changed symbols. This keeps results useful on current extractor fidelity without requiring full cross-file edge resolution.

**Rule:** When extending the query (e.g., adding new edge kinds or heuristic passes), preserve the confidence×weight layering so rank order reflects structural certainty, not just edge count. The `sortRanked` tiebreak is: score desc, confidence desc, JSON.stringify(a).localeCompare(b) for determinism.

**Established in:** M040/S02/T01 (`src/review-graph/query.ts`, `queryBlastRadiusFromSnapshot`).

---

## Optional Graph-Query DI Seam Pattern in Review Handler (M040/S02)

**Context:** `src/handlers/review.ts` accepts an optional `reviewGraphQuery` parameter (typed as `(input: {...}) => Promise<ReviewGraphBlastRadiusResult>`). When the parameter is absent, the review handler falls back to risk-only file selection. When present, it calls the query before large-PR triage, fail-opens on errors, and feeds the result into `applyGraphAwareSelection`.

**Pattern:** The seam is injected at call time rather than wired through config or a global store. Production callers pass the query provider when they have a graph store; tests pass `undefined` to exercise the fallback path without DB access.

**Log fields:** On large PRs, the handler logs `graphHitCount`, `graphRankedSelections`, and `graphAwareSelectionApplied` at the large-PR triage site, making graph influence observable in structured logs.

**Rule:** The graph query injection point must remain optional and fail-open. Any future re-wiring that makes graph data mandatory for review execution breaks the fallback contract and blocks reviews when the graph substrate is unavailable.

**Established in:** M040/S02/T02 (`src/handlers/review.ts`, `reviewGraphQuery` seam; `src/lib/file-risk-scorer.ts`, `applyGraphAwareSelection`).

---

## TOP_N=1 for Rank-Promotion Proof vs. TOP_N>1 for Presence Proof (M040/S02)

**Context:** `verify-m040-s02.ts` MISSED-FILES check uses `TOP_N=1` to assert that the graph-impacted file occupies rank 1 after graph-aware reranking but ranks below 1 under risk-only scoring. Using `TOP_N=2` would include the impacted file in the risk-only top-2 at rank 2, leaving `graphSurfacedExtra` empty and causing the check to incorrectly fail.

**Rule:** When a proof harness needs to demonstrate that graph reranking *promotes* a file to a higher rank (not just that it is present in a larger selection), use `TOP_N=1` or the minimum N that creates a visible gap. "Impacted file present in top-N" and "impacted file promoted into top-1" are two distinct claims — only the second proves the ranking signal is meaningful.

**Established in:** M040/S02/T03 (`scripts/verify-m040-s02.ts`, MISSED-FILES check, TOP_N=1 design decision).

---

## Bounded Prompt Section Pattern — Hard Item Caps + Char Budget Loop (M040/S03)

**Context:** `buildGraphContextSection()` in `src/review-graph/prompt-context.ts` converts a `ReviewGraphBlastRadiusResult` into a bounded Markdown prompt section. Two independent caps apply:

1. **Hard item caps** (applied first, O(cap × max_line_len) worst-case): `maxImpactedFiles` (default 10, capped at 20), `maxLikelyTests` (default 5, capped at 10), `maxDependents` (default 5, capped at 10). Items are rank-ordered before capping.
2. **Char budget loop** (applied second): the assembled section is truncated and a truncation note is appended when it would exceed `maxChars` (default 2500).

The function returns empty text when blast radius is null/empty — this is the fail-open path for backward compatibility with callers that don't pass a graph result.

**Return value carries observability stats:** `charCount`, `impactedFilesIncluded`, `likelyTestsIncluded`, `dependentsIncluded`, and `truncated` are returned alongside `text` so callers can log graph context size without re-parsing the section.

**Rule:** Hard item caps must be applied before the char budget loop — the cap loop is O(N) worst-case per item dropped; the hard cap bounds N so the loop terminates quickly. Do not rely on the budget loop alone to cap item count.

**Established in:** M040/S03/T01 (`src/review-graph/prompt-context.ts`, `buildGraphContextSection`).

---

## Trivial-Change Bypass — Fail-Closed on Zero Files (M040/S03)

**Context:** `isTrivialChange()` in `src/review-graph/validation.ts` returns `bypass: false` when `changedFileCount === 0` (fail-closed), not `bypass: true`. This is intentional: zero changed files is an unexpected input that may indicate a data problem — running the graph is safer than silently skipping it.

The default threshold is 3 files. Line threshold is opt-in (default 0 = disabled). The function is configurable via `TrivialChangeOptions` and always returns a `reason` string for structured logging.

**Rule:** Do not treat zero changed files as "trivially small". The fail-closed behavior on zero files is a deliberate invariant — a proof harness check (`M040-S03-TRIVIAL-BYPASS`) enforces it explicitly.

**Established in:** M040/S03/T02 (`src/review-graph/validation.ts`, `isTrivialChange`).

---

## Non-Destructive Validation Annotation — Never Suppress, Always Fail-Open (M040/S03)

**Context:** `validateGraphAmplifiedFindings()` in `src/review-graph/validation.ts` is a second-pass LLM gate for findings on graph-amplified (not directly changed) files. Its design invariants are:

- **Non-destructive:** Adds `graphValidated` and `graphValidationVerdict` metadata to output findings — never removes or suppresses findings regardless of verdict.
- **Graph-scoped:** Only validates findings on files in `impactedFiles`/`probableDependents` that are NOT in the changed-file set. Findings on directly changed files pass through with `graphValidated: false, graphValidationVerdict: "skipped"`.
- **Fail-open:** Any LLM error, unparseable response, or unexpected exception returns the original findings unmodified with `succeeded: false`. The review pipeline is never blocked.
- **Configurable:** Validation only runs when `enabled: true` (default false) and when `llm` and `blastRadius` are provided.

**Rule:** Future extensions to this gate must preserve all four invariants. In particular, adding verdict-based suppression logic would violate the non-destructive contract — callers choose how to act on verdicts; the gate only annotates.

**Established in:** M040/S03/T02 (`src/review-graph/validation.ts`, `validateGraphAmplifiedFindings`).

---

## Dynamic Import Pattern for Optional LLM Gate in Review Handler (M040/S03)

**Context:** The optional graph validation gate in `src/handlers/review.ts` uses a dynamic `import()` to load the `GUARDRAIL_CLASSIFICATION` task router at the point of use rather than a top-level static import. This avoids circular dependency issues between the handler and the task router.

**Pattern:** The gate is guarded by `config.review.graphValidation?.enabled` (accessed via type assertion, not Zod schema — the config schema addition was deferred). Because the gate is inert by default (requires explicit opt-in), the dynamic import only executes in enabled deployments.

**Rule:** When adding new optional LLM gates to the review handler that use task routers, use dynamic imports inside the gate block to prevent circular dependencies. The `GUARDRAIL_CLASSIFICATION` task type is the correct choice for lightweight validation passes matching existing non-agentic usage patterns.

**Established in:** M040/S03/T02 (`src/handlers/review.ts`, graph validation gate block).

---

## Canonical Code Selective Update: File-Level Soft-Delete on Identity Shrink (M041/S03)

**Context:** `updateCanonicalCodeSnapshot()` in `src/knowledge/canonical-code-update.ts` handles the case where a changed file drops one or more chunk identities (e.g., a function was deleted). The store only supports file-level soft-delete (`deleteChunksForFile`), so when any identity disappears the updater must delete all live rows for that file and then re-upsert the surviving identities.

**Implication:** If a file loses exactly one chunk but retains others, all rows for that file are deleted and the survivors are re-upserted. Normal steady-state refresh (no identity changes) still preserves unchanged rows via hash comparison without any deletes. The file-level delete path fires only when `existingChunks.some(id => !nextIdentityKeys.has(id))`.

**Rule:** Do not treat the file-level delete-and-restore as evidence that unchanged rows are being unnecessarily rewritten — it only fires when the chunk identity set actually shrinks. Tests asserting "zero deletes" are valid for truly unchanged files but must use fixtures where the identity set is stable.

**Established in:** M041/S03/T01 (`src/knowledge/canonical-code-update.ts`, `updateCanonicalCodeSnapshot`).

---

## number→bigint ID Bridge for Canonical Code Repair (M041/S03)

**Context:** The generic `EmbeddingRepairStore` interface uses `number` for row IDs (matching the `id` column type across most corpora). `canonical_code_chunks` uses a `bigint` PK. `createCanonicalCodeRepairStore()` in `src/knowledge/embedding-repair.ts` bridges this mismatch by reading the bigint PK into a JS `number` via `Number(row.id)` and converting back via `BigInt(id)` on write.

**When this is safe:** All chunk IDs inserted during normal operation are sequential starting from 1. PostgreSQL bigint can hold values up to 9,223,372,036,854,775,807; JS `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991. For typical corpus sizes (millions, not billions), the conversion is loss-free.

**Rule:** If the corpus ever grows into the billions of rows (extremely unlikely), revisit the bridge and update `EmbeddingRepairStore` to support `bigint` IDs natively. Until then, the `Number(bigint)` bridge is the established pattern for canonical code repair integration.

**Established in:** M041/S03/T02 (`src/knowledge/embedding-repair.ts`, `createCanonicalCodeRepairStore`).

---

## Canonical Code Repair Has No Persistent Checkpoint (M041/S03)

**Context:** The canonical code repair runner (`runCanonicalCodeEmbeddingRepair()` in `src/knowledge/embedding-repair.ts`) does not use a persistent checkpoint table — unlike some other repair flows. Each run calls `listStaleChunks` as the implicit progress signal; if a run is interrupted, re-running will pick up all remaining stale/missing/model-mismatch rows from scratch.

**Why:** Canonical code chunks are identified by `(repo, owner, canonical_ref, file_path, chunk_type, symbol_name)` and are individually idempotent on re-embed. The 2000-row `CANONICAL_CODE_REPAIR_LIMIT` bounds per-pass exposure so run-to-completion is typically fast enough that a checkpoint would add complexity without meaningful benefit.

**Rule:** If repair jobs regularly time out before completion (i.e., the corpus consistently has >2000 drifted rows per pass), consider adding a cursor/checkpoint column on `canonical_code_chunks`. Until then, stateless repair with a bounded per-pass limit is the correct operating pattern.

**Established in:** M041/S03/T02 (`src/knowledge/embedding-repair.ts`, `CANONICAL_CODE_REPAIR_LIMIT`).
