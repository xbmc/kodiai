# S02: TypeScript Fixes & Code Quality — Research

**Date:** 2026-03-11

## Summary

S02 needs to fix 461 TypeScript errors across 58 files, replace 39 console.log/warn/error calls with pino in production code, make 3 failing DB tests skip gracefully, and lightly extract pure helpers from review.ts (4,415 lines) and mention.ts (2,677 lines).

The error breakdown is favorable: 360 of 461 errors (78%) are just two error codes — TS18048 ("possibly undefined") and TS2532 ("Object is possibly undefined") — caused by `noUncheckedIndexedAccess: true` in tsconfig. These are mechanical fixes (add `!`, add null checks, or destructure with guards). The remaining 101 errors split across type mismatches in test mocks, `sql.begin()` transaction callable issues (postgres.js known limitation), 3 vitest imports that should be bun:test, and missing type properties in test fixtures.

The work divides cleanly: production code has 132 errors across 25 files; test code has 329 errors across 33 files. Production errors should be fixed first (proper null checks preferred over `!` assertions), then test errors (where `as` casts and `!` assertions are acceptable).

## Recommendation

Split into 4-5 tasks:
1. **TS errors in production code** (132 errors, 25 files) — fix file-by-file, run `bunx tsc --noEmit` after each group
2. **TS errors in test code** (329 errors, 33 files) — fix fixtures (add missing fields), fix vitest→bun:test imports, fix mock casts
3. **console.log → pino** (39 calls in ~12 non-test files) — some files already have logger params, others need logger injection
4. **DB test graceful skipping** (3 pgvector store tests) — add `DATABASE_URL` check in `beforeAll`, skip describe block
5. **Light extraction from review.ts** — move pure utility functions (fingerprintFindingTitle, normalizeSeverity, normalizeCategory, normalizeSkipPattern, splitDiffByFile, etc.) to `src/lib/review-utils.ts`

Do task 1 and 2 first since they're the bulk. Task 5 (extraction) is lower priority and higher risk.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| postgres.js `tx` not callable | `tx.unsafe()` pattern | Already used in `src/db/migrate.ts:49` — apply same `TransactionSql` workaround to stores |
| vitest imports in 3 test files | `bun:test` | Project standard; vitest not installed |
| Structured logging | pino (already dep) | Already used everywhere via `Logger` type from pino |

## Existing Code and Patterns

- `src/db/client.ts` — defines `Sql` type as `ReturnType<typeof postgres>`; transaction callable issue is inherent to this typing
- `src/db/migrate.ts:49` — documents `tx.unsafe()` workaround for `TransactionSql`'s stripped call signature; stores need a different fix since they use tagged templates not `unsafe()`
- `src/knowledge/store.ts` — 32 errors, largest production error source; mostly `TS18048`/`TS2532` from query results + `TS2349` from `tx` template literal calls
- `src/telemetry/store.test.ts` — 68 errors, largest test error source; all nullability from query results
- `src/handlers/review.ts` — 28 pure utility functions before `createReviewHandler` (lines 168-1308); extraction candidates are functions with no closure over handler deps
- `src/handlers/mention.ts` — only 3 top-level exports; `buildWritePolicyRefusalMessage` and `scanLinesForFabricatedContent` are already extractable pure functions
- `src/lib/` — 64 files already; established pattern for extracted utilities
- `src/knowledge/issue-store.test.ts` — exemplar of DB test that doesn't skip; `beforeAll` connects directly without checking `DATABASE_URL`
- `src/knowledge/memory-store.test.ts` — same pattern, needs skip guard

## Constraints

- `noUncheckedIndexedAccess: true` in tsconfig — every array/object index access returns `T | undefined`; this is intentional and must not be disabled
- `strict: true` — non-negotiable; drives most of the TS18048/TS2532 errors
- Must not change runtime behavior — all fixes are type-level or logging-level
- Tests must pass after every batch of changes — incremental verification required
- `sql.begin()` callback parameter (`tx`) loses its call signature due to postgres.js types using `Omit<>` — the existing decision says "TransactionSql uses tx.unsafe() for parameterized queries due to Omit<> stripping call signatures"
- 3 test files import from `vitest` which isn't installed — these need `bun:test` imports
- `console.log` in `src/db/migrate.ts` is acceptable (CLI migration tool, not production server code)
- `console.error` in `src/config.ts` for FATAL errors is acceptable (runs before logger is initialized)
- `console.error` in `src/index.ts` for uncaught exceptions is acceptable (process-level handler)

## Error Taxonomy

### Production Code (132 errors, 25 files)

| Error | Count | Pattern | Fix Strategy |
|-------|-------|---------|-------------|
| TS18048 | 64 | "possibly undefined" from indexed access | Add null checks or `!` when value guaranteed |
| TS2532 | 25 | "Object possibly undefined" | Same as above |
| TS2345 | 16 | Argument type mismatch (scripts AppConfig, MCP tool handlers, logger types) | Add missing fields to config objects; fix handler signatures |
| TS2349 | 15 | `tx` template literal not callable (postgres.js) | Type assertion on `tx` in `sql.begin()` callbacks |
| TS2339 | 3 | Property doesn't exist (review.ts `snippet`, `changedFiles`) | Fix property access to match actual types |
| TS2322 | 2 | Type assignment mismatch | Fix type annotations |
| Other | 7 | Various (TS7034, TS7005, TS2552, TS2538, TS2769, TS2740, TS2352) | Case-by-case |

### Test Code (329 errors, 33 files)

| Error | Count | Pattern | Fix Strategy |
|-------|-------|---------|-------------|
| TS2532 | 146 | Query result possibly undefined | Add `!` assertions (test context, values known) |
| TS18048 | 119 | Same as above | Same |
| TS2352 | 19 | Mock cast mismatch | Use `as unknown as Type` two-step cast |
| TS2739 | 15 | Missing properties on test fixtures (MentionEvent missing `issueBody`/`issueTitle`) | Add missing fields |
| TS2322 | 8 | Type assignment in test setup | Fix type annotations |
| TS2740 | 7 | Missing properties | Add missing fields |
| TS2307 | 3 | Can't find `vitest` module | Change to `bun:test` import |
| Other | 12 | Various | Case-by-case |

## Common Pitfalls

- **Fixing TS2349 (tx not callable) incorrectly** — the `tx` from `sql.begin()` loses its tagged-template call signature. Don't try `tx.unsafe()` for tagged template calls. Instead, type-assert `tx` as `Sql` inside the begin callback. This is safe because the transaction sql has the same runtime behavior.
- **Over-using `!` non-null assertions in production code** — prefer actual null checks with early returns or defaults for production code. `!` is acceptable in test code where values are known.
- **Breaking test expectations when adding null checks** — adding a null guard that returns early could change behavior. Verify tests still pass after each file group.
- **console.log removal in wrong files** — `src/db/migrate.ts`, `src/config.ts`, and `src/index.ts` process-level handlers should keep console.* since they run before/without logger. Focus on `src/knowledge/wiki-*`, `src/execution/mcp/*`, `src/execution/mention-context.ts`, `src/lib/guardrail/audit-store.ts`, `src/llm/pricing.ts`.
- **Extracting impure functions from review.ts** — only extract functions that don't close over handler state. Functions like `executeSearchWithRateLimitRetry` take explicit params and are safe. Functions inside `createReviewHandler` that reference closure variables are not.
- **MentionEvent test fixture drift** — 12 test files have `MentionEvent` fixtures missing `issueBody`/`issueTitle` fields. These were likely added to the type after the tests were written. Add them to all fixtures at once.

## Open Risks

- **postgres.js `tx` typing** — 15 errors across 5 store files. The `tx` is typed as `TransactionSql` which uses `Omit<>` that strips the tagged-template call signature. Casting `tx as Sql` is the pragmatic fix but slightly misrepresents the type. This is a known postgres.js limitation with no clean upstream fix.
- **review.ts extraction scope** — mention.ts has only 2 extractable functions (53 + 33 lines). review.ts has ~28 pre-handler functions totaling ~1100 lines, but some reference types/imports that would need to move too. Keep extraction conservative — move only obviously pure helpers.
- **TS2345 in scripts/** — 4 backfill scripts have `AppConfig` type mismatches (missing `botUserPat`, `botUserLogin`, etc.). These scripts may not be actively used; fix by adding missing fields with empty defaults.
- **`wiki-update-generator.ts` TS2552** — references `guardrailAuditStore` which doesn't exist (should be `createGuardrailAuditStore`). This may indicate a real bug, not just a type error.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript | N/A | Core language — no skill needed |
| postgres.js | N/A | Types issue is well-understood from codebase decisions |
| pino | N/A | Already used throughout; pattern established |
| bun:test | N/A | Project standard test framework |

No external skills are relevant for this slice — it's pure TypeScript/codebase-quality work.

## Sources

- `bunx tsc --noEmit` output — 461 errors across 58 files (132 production, 329 test)
- `bun test` output — 2181 pass, 3 fail (all pgvector store tests without DATABASE_URL)
- `tsconfig.json` — strict mode with `noUncheckedIndexedAccess: true`
- `src/db/migrate.ts:49` — documents `tx.unsafe()` workaround for TransactionSql
- DECISIONS.md — "TransactionSql uses tx.unsafe() for parameterized queries due to Omit<> stripping call signatures"
- DECISIONS.md — "M026: DB-dependent tests should skip gracefully when DATABASE_URL is not set"
