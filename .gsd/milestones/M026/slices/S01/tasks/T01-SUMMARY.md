---
id: T01
parent: S01
milestone: M026
provides:
  - Deprecated db-path files removed
  - Orphaned test-delta-verification.ts removed
  - Stale SQLite JSDoc references fixed to PostgreSQL
  - Deprecated SQLite-era stats/trends scripts removed
key_files:
  - src/telemetry/types.ts
key_decisions:
  - Also deleted scripts/kodiai-stats.ts and scripts/kodiai-trends.ts — they imported the deleted db-path module and used bun:sqlite, making them deprecated SQLite-era tooling
patterns_established: []
observability_surfaces:
  - none
duration: quick
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T01: Delete deprecated files and fix stale comments

**Removed 5 deprecated/orphaned files and updated 3 stale SQLite references to PostgreSQL.**

## What Happened

Verified `src/knowledge/db-path.ts` had no production importers (only its own test). Deleted it, its test, and the orphaned `test-delta-verification.ts`. Updated 3 JSDoc comments in `src/telemetry/types.ts` from "telemetry SQLite database" to "telemetry PostgreSQL database" (lines 4, 69, 90).

During TS verification, discovered `scripts/kodiai-stats.ts` and `scripts/kodiai-trends.ts` imported the deleted `db-path` module and used `bun:sqlite` — deprecated SQLite-era scripts with no other references. Deleted them to avoid introducing new TS errors.

## Verification

- `test -f src/knowledge/db-path.ts` → PASS (gone)
- `test -f src/knowledge/db-path.test.ts` → PASS (gone)
- `test -f test-delta-verification.ts` → PASS (gone)
- `grep -c 'SQLite' src/telemetry/types.ts` → 0
- `bunx tsc --noEmit 2>&1 | grep 'db-path' | wc -l` → 0
- Slice checks: db-path.ts PASS, test-delta PASS, SQLite refs 0
- Remaining slice checks (.planning, .env.example, branches, deployment.md) not yet expected — later tasks

## Diagnostics

None — no runtime changes.

## Deviations

Also deleted `scripts/kodiai-stats.ts` and `scripts/kodiai-trends.ts` (not in original plan) — they depended on deleted `db-path` module and `bun:sqlite`, would have caused new TS errors.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/db-path.ts` — deleted (deprecated)
- `src/knowledge/db-path.test.ts` — deleted (test for deprecated module)
- `test-delta-verification.ts` — deleted (orphaned test fixture)
- `scripts/kodiai-stats.ts` — deleted (deprecated SQLite-era script)
- `scripts/kodiai-trends.ts` — deleted (deprecated SQLite-era script)
- `src/telemetry/types.ts` — updated 3 JSDoc comments from SQLite to PostgreSQL
