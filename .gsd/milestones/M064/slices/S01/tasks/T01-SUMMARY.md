---
id: T01
parent: S01
milestone: M064
key_files:
  - src/db/migrations/039-continuation-family-state.sql
  - src/db/migrations/039-continuation-family-state.down.sql
  - src/knowledge/types.ts
  - src/knowledge/store.ts
  - src/knowledge/store.test.ts
key_decisions:
  - Used one canonical row per `(familyKey, baseReviewOutputKey)` and guarded updates with `authoritativeAttemptOrdinal` so durable authority remains restart-safe and supersession-safe without reading checkpoint JSON or telemetry.
duration: 
verification_result: passed
completed_at: 2026-04-24T07:05:57.861Z
blocker_discovered: false
---

# T01: Added the canonical continuation-family migration, typed store contract, and compare-and-upsert query seam for durable authority state.

**Added the canonical continuation-family migration, typed store contract, and compare-and-upsert query seam for durable authority state.**

## What Happened

I added a dedicated `continuation_family_state` table in `src/db/migrations/039-continuation-family-state.sql` with controlled constraints for authoritative outcome, final stop reason, projection status, and a per-family/base-key uniqueness contract. In `src/knowledge/types.ts` I introduced the typed continuation-family enums and record/query types, then extended `KnowledgeStore` with `upsertContinuationFamilyState(...)` and `getContinuationFamilyState(...)`. In `src/knowledge/store.ts` I implemented those methods with an ordinal-guarded `ON CONFLICT DO UPDATE` so late or superseded attempts cannot overwrite newer authoritative state, while newer attempts can replace older family rows deterministically. In `src/knowledge/store.test.ts` I added real store coverage for insert/read, restart-shaped durability via store recreation, stale-attempt suppression, and newer-attempt replacement. I did not wire runtime handlers yet; this task stops at the schema/types/store seam defined in the plan.

## Verification

Ran the task verification command `bun test src/knowledge/store.test.ts` before and after the implementation. The command exited successfully both times, but this workspace does not have `TEST_DATABASE_URL` configured, so Bun skipped the PostgreSQL-backed store tests instead of executing them. To compensate for code-shape verification in-session, I also ran `bun run tsc --noEmit`, which passed cleanly and confirmed the new migration/store/type contracts compile. LSP diagnostics were unavailable because no language server is configured in this workspace.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/knowledge/store.test.ts` | 0 | ✅ pass | 98ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8395ms |

## Deviations

None. The implementation stayed within the task contract: migration pair, typed enums/records, store seam, and test coverage additions without handler wiring.

## Known Issues

`TEST_DATABASE_URL` is not configured in this auto-mode environment, so the PostgreSQL-backed `src/knowledge/store.test.ts` cases were skipped rather than exercised against a real database. Also, `capture_thought` failed when attempting to save the ordinal-guard architecture note to memory storage.

## Files Created/Modified

- `src/db/migrations/039-continuation-family-state.sql`
- `src/db/migrations/039-continuation-family-state.down.sql`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/knowledge/store.test.ts`
