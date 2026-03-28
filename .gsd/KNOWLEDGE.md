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
