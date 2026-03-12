---
id: T01
parent: S02
milestone: M026
provides:
  - zero production TypeScript errors
key_files:
  - src/knowledge/store.ts
  - src/knowledge/wiki-publisher.ts
  - src/triage/template-parser.ts
  - src/lib/guardrail/pipeline.ts
  - src/handlers/review.ts
  - src/knowledge/wiki-update-generator.ts
key_decisions:
  - "Use `!` for array index access guarded by length checks or guaranteed by SQL RETURNING/aggregate queries"
  - "Cast `(tx as unknown as Sql)` for postgres.js transaction callbacks per DECISIONS.md pattern"
  - "Add `partially-grounded` to UpdateSuggestion.groundingStatus union — the code produces it and the DB column accepts it"
  - "Fix `changedFiles` → `filesByCategory` in review.ts (property didn't exist on DiffAnalysis)"
  - "Fix embedding return type: extract `.embedding` from provider result object"
  - "Pass guardrailAuditStore as parameter to processPage() in wiki-update-generator (was out of scope — real bug)"
patterns_established:
  - "noUncheckedIndexedAccess: use `!` for index access in bounded for-loops and after length guards"
  - "regex match groups: use `match[1]!` after null-check on the match itself"
  - "MCP tool handlers: add index signature `[key: string]: unknown` to ToolResult for SDK compatibility"
  - "Script configs: include all AppConfig fields (slackWikiChannelId, wikiStaleness*, wikiGithub*, botUser*)"
observability_surfaces:
  - "bunx tsc --noEmit error count (production filter: grep -v .test. | grep -v __test)"
duration: 1 session
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T01: Fix TypeScript errors in production code (145 errors, 32 files)

**Fixed all 145 TypeScript errors across 33 production files, reaching zero production TS errors.**

## What Happened

Fixed 145 TypeScript errors across 33 files. The errors fell into these categories:

1. **TS18048/TS2532 (nullable from noUncheckedIndexedAccess)** — ~100 errors. Fixed with `!` assertions where values are guaranteed by surrounding logic (length guards, bounded for-loops, SQL RETURNING, aggregate queries, regex match groups after null checks).

2. **TS2349 (tx not callable)** — 12 errors in 5 store files. Fixed by casting `(tx as unknown as Sql)` in `sql.begin()` callbacks per the established DECISIONS.md pattern.

3. **TS2345 (argument type mismatches)** — ~15 errors. Fixed script configs missing AppConfig fields, MCP tool handler signatures, embedding provider return type extraction.

4. **TS2339 (missing properties)** — 3 errors. `snippet` didn't exist on `UnifiedRetrievalChunk` (removed), `changedFiles` didn't exist on `DiffAnalysis` (replaced with `filesByCategory`).

5. **TS2552 (guardrailAuditStore not in scope)** — 1 error. Real bug: `processPage()` was a standalone function but referenced closure variable. Fixed by passing as parameter.

6. **TS2322 (type narrowing)** — 2 errors. Added `partially-grounded` to `UpdateSuggestion.groundingStatus` union type, coerced `undefined` to `null` for version fields.

## Verification

- `bunx tsc --noEmit 2>&1 | grep -v '.test.' | grep -v '__test' | grep -c 'error TS'` → **0** ✅
- `bun test` → **2181 pass, 3 fail** (pre-existing DB connection failures) ✅

### Slice-level checks:
- `bunx tsc --noEmit` production errors → 0 ✅ (partial — test file errors remain for T02)
- `bun test` → 3 failures (within ≤4 allowed) ✅

## Diagnostics

Inspect via `bunx tsc --noEmit` — zero production errors expected. Filter with `grep -v '.test.' | grep -v '__test'` for production-only view.

## Deviations

- Fixed 33 files instead of planned 32 (wiki-update-types.ts also needed a type union update)
- The TS2552 `guardrailAuditStore` bug was a real scoping bug, not just a typo — fixed by threading the store as a function parameter

## Known Issues

- Test file TS errors remain (~200+) — these are T02's scope
- 3 pre-existing test failures (DB connection) — not caused by these changes

## Files Created/Modified

- `src/knowledge/store.ts` — tx casts, null assertions on query results (32 errors)
- `src/knowledge/wiki-publisher.ts` — null assertions on indexed loop vars (25 errors)
- `src/triage/template-parser.ts` — null assertions on regex groups and array indexing (15 errors)
- `src/lib/guardrail/pipeline.ts` — null assertions, LlmClassifierClaim import (8 errors)
- `src/lib/guardrail/adapters/mention-adapter.ts` — null assertions on array indexing (5 errors)
- `src/lib/guardrail/adapters/wiki-adapter.ts` — null assertions on array indexing (4 errors)
- `src/lib/guardrail/adapters/troubleshoot-adapter.ts` — null assertion on regex group (2 errors)
- `src/lib/guardrail/llm-classifier.ts` — null assertion on regex group (1 error)
- `src/execution/review-prompt.ts` — null assertion on indexed loop var (8 errors)
- `src/handlers/review.ts` — explicit type annotation, property fixes (5 errors)
- `src/handlers/issue-closed.ts` — null assertions on query results (2 errors)
- `src/handlers/review-comment-sync.ts` — extract .embedding from provider result (1 error)
- `src/handlers/troubleshooting-agent.ts` — double cast via unknown (1 error)
- `src/knowledge/review-comment-backfill.ts` — extract .embedding from provider result (1 error)
- `src/knowledge/review-comment-store.ts` — tx casts (2 errors)
- `src/knowledge/wiki-store.ts` — tx casts (2 errors)
- `src/knowledge/wiki-update-generator.ts` — pass guardrailAuditStore param, tx casts (4 errors)
- `src/knowledge/wiki-update-types.ts` — add partially-grounded to union (1 error)
- `src/knowledge/wiki-voice-analyzer.ts` — fix Logger generic type (2 errors)
- `src/knowledge/wiki-popularity-store.ts` — use Date() instead of sql fragment in values array (1 error)
- `src/lifecycle/webhook-queue-store.ts` — tx casts (2 errors)
- `src/execution/mcp/issue-comment-server.ts` — index signature on ToolResult, extra param (2 errors)
- `src/execution/mcp/issue-label-server.ts` — index signature on ToolResult, extra param (1 error)
- `src/routes/slack-events.ts` — null assertion on array access (1 error)
- `src/triage/threshold-learner.ts` — null assertions on query results (4 errors)
- `src/triage/triage-agent.ts` — null assertion on regex group (1 error)
- `scripts/backfill-issues.ts` — add missing AppConfig fields (1 error)
- `scripts/backfill-pr-evidence.ts` — add missing AppConfig fields (1 error)
- `scripts/backfill-review-comments.ts` — add missing AppConfig fields (1 error)
- `scripts/sync-triage-reactions.ts` — add missing AppConfig fields, fix Map type, null assertions (4 errors)
- `scripts/embedding-comparison.ts` — extract to local vars to satisfy null checks (4 errors)
- `scripts/publish-wiki-updates.ts` — add missing AppConfig fields (1 error)
- `scripts/wiki-embedding-backfill.ts` — null assertion on array index (1 error)
