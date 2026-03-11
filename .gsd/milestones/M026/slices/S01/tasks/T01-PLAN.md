---
estimated_steps: 4
estimated_files: 4
---

# T01: Delete deprecated files and fix stale comments

**Slice:** S01 — Dead Code Removal & Repo Hygiene
**Milestone:** M026

## Description

Remove 3 deprecated/orphaned files and update 3 stale SQLite references in comments to PostgreSQL. This is the safest first step — removes dead code before any config or git operations.

## Steps

1. Verify `src/knowledge/db-path.ts` has no production importers: `rg 'db-path' src/ --type ts` should show only db-path.test.ts
2. Delete `src/knowledge/db-path.ts`, `src/knowledge/db-path.test.ts`, and `test-delta-verification.ts`
3. Update 3 JSDoc references in `src/telemetry/types.ts` from "telemetry SQLite database" to "telemetry PostgreSQL database" (lines ~4, ~69, ~90)
4. Commit: `chore(S01): remove deprecated files and fix stale SQLite references`

## Must-Haves

- [ ] db-path.ts and db-path.test.ts deleted
- [ ] test-delta-verification.ts deleted
- [ ] All "SQLite" references in telemetry/types.ts changed to "PostgreSQL"
- [ ] No production import breaks (verified before deletion)

## Verification

- `test -f src/knowledge/db-path.ts && echo FAIL || echo PASS` → PASS
- `test -f src/knowledge/db-path.test.ts && echo FAIL || echo PASS` → PASS
- `test -f test-delta-verification.ts && echo FAIL || echo PASS` → PASS
- `grep -c 'SQLite' src/telemetry/types.ts` → 0
- `bunx tsc --noEmit 2>&1 | grep 'db-path' | wc -l` → 0 (no new TS errors from deletion)

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: None
- Failure state exposed: None

## Inputs

- S01-RESEARCH.md confirmed db-path.ts only imported by its own test
- S01-RESEARCH.md confirmed test-delta-verification.ts has zero importers
- S01-RESEARCH.md identified telemetry/types.ts lines 4, 69, 90

## Expected Output

- `src/knowledge/db-path.ts` — deleted
- `src/knowledge/db-path.test.ts` — deleted
- `test-delta-verification.ts` — deleted
- `src/telemetry/types.ts` — 3 comment references updated from SQLite to PostgreSQL
