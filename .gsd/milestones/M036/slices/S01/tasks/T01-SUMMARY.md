---
id: T01
parent: S01
milestone: M036
key_files:
  - src/db/migrations/035-generated-rules.sql
  - src/knowledge/generated-rule-store.ts
  - src/knowledge/generated-rule-store.test.ts
  - src/knowledge/index.ts
key_decisions:
  - Deduplicate generated rules by (repo, title) and keep pending-rule upserts from downgrading ACTIVE or RETIRED rows.
  - Expose lifecycle observability through durable status timestamps plus getLifecycleCounts(repo) rather than mixing generated-rule state into learning_memories.
duration: 
verification_result: passed
completed_at: 2026-04-04T22:18:54.433Z
blocker_discovered: false
---

# T01: Added generated-rule persistence with lifecycle transitions and repo-level lifecycle counts.

**Added generated-rule persistence with lifecycle transitions and repo-level lifecycle counts.**

## What Happened

Added a dedicated generated-rule persistence layer instead of extending raw learning-memory storage. The new migration creates a generated_rules table with repo scoping, pending/active/retired lifecycle state, signal/member metadata, centroid storage, and status-specific indexes. The new GeneratedRuleStore provides explicit lifecycle methods for saving pending proposals, activating and retiring rules, listing repo rules, retrieving active rules, and reporting repo-level lifecycle counts. The pending-rule upsert path is intentionally non-downgrading: repeated proposals refresh proposal data but preserve ACTIVE or RETIRED state. I also exported the store from src/knowledge/index.ts and added DB-gated regression tests for persistence, lifecycle transitions, active filtering, and lifecycle counts.

## Verification

Ran the task verification gate. `bun test ./src/knowledge/generated-rule-store.test.ts` exited 0 and skipped cleanly because TEST_DATABASE_URL is unset in this environment. `bun run tsc --noEmit` passed, confirming the new store and exports typecheck cleanly.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/generated-rule-store.test.ts` | 0 | ✅ pass | 59ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6404ms |

## Deviations

None.

## Known Issues

DB-backed store tests skip in this environment because TEST_DATABASE_URL is not set, so live persistence could not be exercised during auto-mode.

## Files Created/Modified

- `src/db/migrations/035-generated-rules.sql`
- `src/knowledge/generated-rule-store.ts`
- `src/knowledge/generated-rule-store.test.ts`
- `src/knowledge/index.ts`
