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
